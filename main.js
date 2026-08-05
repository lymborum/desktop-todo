const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

let win = null;
const dataFile = () => path.join(app.getPath('userData'), 'tasks.json');

// 前台窗口检测 / 壁纸层挂载工具（tools/，源码见同目录 .cs，Windows 下用 csc 编译）
const FG_CHECK = path.join(__dirname, 'tools', 'fgcheck.exe');
const PIN_TO_DESKTOP = path.join(__dirname, 'tools', 'pin-to-desktop.exe');
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW']); // Windows 桌面
let lastFgClass = '';
let fgTimer = null;
let pinnedToDesktop = false; // 是否已挂载到桌面层（壁纸层）

// 设置
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};
try { settings = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}; } catch { settings = {}; }

const modeInit = settings.mode;
let mode = (modeInit && modeInit.mode) || 'free';          // 'free' 自由 | 'edge' 边框
let dockEdge = (modeInit && modeInit.edge) || 'right';
let edgePos = (modeInit && modeInit.edgePos) || 0;         // 沿边位置 (左右: y; 上下: x)
let dockOpen = false, closeTimer = null, animTimer = null;
let userMoving = false;
let pinned = false;

const STRIP = 10, GAP = 24;
const WIN_W = 300, WIN_H = 340; // 固定尺寸，防止透明窗口被 Windows 撑大

app.setAppUserModelId('com.glasstodo.app');

// 单实例：重复启动时唤醒已有窗口
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWin());

  app.whenReady().then(() => {
    createWindow();

    // 全局快捷键
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      showWin();
      if (mode === 'edge' && !dockOpen) openDock();
      win.webContents.send('show-add');
    });
    globalShortcut.register('CommandOrControl+Shift+H', () => {
      if (win && win.isVisible()) win.hide();
      else { showWin(); if (mode === 'edge' && !dockOpen) openDock(); }
    });

    // ── IPC ──
    ipcMain.handle('tasks:load', () => {
      try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); }
      catch { return null; }
    });
    ipcMain.on('tasks:save', (e, data) => {
      try { fs.writeFileSync(dataFile(), JSON.stringify(data, null, 2)); }
      catch (err) { console.error('save failed', err); }
    });
    ipcMain.on('app:quit', () => app.quit());
    ipcMain.on('win:hide', () => { if (win) win.hide(); });
    ipcMain.on('win:show', showWin);
    ipcMain.on('win:resize', (e, w, h) => {
      if (!win) return;
      win.setContentSize(Math.round(w), Math.round(h));
      if (mode === 'edge') applyEdgeState();
    });
    ipcMain.handle('login:get', () => app.getLoginItemSettings().openAtLogin);
    ipcMain.on('login:set', (e, on) => app.setLoginItemSettings({ openAtLogin: !!on }));
    ipcMain.handle('mode:get', () => ({ mode, open: dockOpen, edge: dockEdge, edgePos }));
    ipcMain.on('mode:set', (e, m) => {
      if (m === 'edge') {
        mode = 'edge';
        // 贴到离当前窗口最近的边
        const wa = screen.getPrimaryDisplay().workArea;
        const b = win.getBounds();
        const L = wa.x, R = wa.x + wa.width, T = wa.y, B = wa.y + wa.height;
        const d = { right: R-(b.x+b.width), left: b.x-L, top: b.y-T, bottom: B-(b.y+b.height) };
        let best = 'right', bestD = 1e9;
        for (const k of ['right','left','top','bottom']) { if (d[k] < bestD) { best = k; bestD = d[k]; } }
        dockEdge = best;
        edgePos = (best === 'right' || best === 'left') ? b.y : b.x;
        dockOpen = true; // 先进来展开，让用户看到贴好了
        saveModeState();
        notifyRendererDock();
        const p = edgePositions();
        animateTo(p.x, p.y, 320);
      } else {
        mode = 'free';
        dockOpen = false;
        saveModeState();
        notifyRendererDock();
      }
    });
    ipcMain.on('pin:set', (e, on) => {
      pinned = !!on;
      if (pinned && mode === 'edge' && !dockOpen) openDock();
    });
    ipcMain.on('win:drag-start', () => { if (win && mode === 'edge') startDragPoll(); });
    ipcMain.on('win:drag-end', () => stopDragPoll());
    // 鼠标进入/离开窗口 → 抽屉抽出 / 收起（浏览器原生事件，比轮询可靠）
    ipcMain.on('dock:enter', () => {
      clearTimeout(closeTimer);
      if (mode === 'edge' && !dockOpen && !userMoving) {
        // 已挂载到桌面层时，鼠标能划过窗口边缘 = 窗口未被盖住（在桌面），可正常弹出；
        // 未挂载时：窗口不在前台、且当前不是在桌面上才不自动弹出
        if (!pinnedToDesktop && !win.isFocused() && !pinned && !DESKTOP_CLASSES.has(lastFgClass)) return;
        openDock();
      }
    });
    ipcMain.on('dock:leave', () => {
      if (mode !== 'edge' || !dockOpen || pinned) return;
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { closeTimer = null; closeDock(); }, 350);
    });
  });

  app.on('window-all-closed', () => { /* 常驻，点退出才退 */ });
}

function showWin() {
  if (!win) return;
  win.show();
  win.focus();
}

/* ── 两种模式：自由悬浮 / 边框(抽屉) ── */
function setPos(x, y) {
  // 用 setBounds 强制尺寸，防止透明窗口被 Windows 意外撑大
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: WIN_W, height: WIN_H });
}
function notifyRendererDock() {
  if (win && !win.isDestroyed()) win.webContents.send('dock-state', { mode, open: dockOpen, edge: dockEdge, edgePos });
}
function edgePositions() {
  const wa = screen.getPrimaryDisplay().workArea;
  const L = wa.x, R = wa.x + wa.width, T = wa.y, B = wa.y + wa.height;
  if (dockEdge === 'right')  return { x: dockOpen ? R - WIN_W : R - STRIP, y: edgePos };
  if (dockEdge === 'left')   return { x: dockOpen ? L : L + STRIP - WIN_W, y: edgePos };
  if (dockEdge === 'top')    return { x: edgePos, y: dockOpen ? T : T + STRIP - WIN_H };
  return { x: edgePos, y: dockOpen ? B - WIN_H : B - STRIP };
}
function applyEdgeState() {
  if (!win || mode !== 'edge') return;
  const p = edgePositions();
  setPos(p.x, p.y);
}
function saveModeState() {
  settings.mode = { mode, edge: dockEdge, edgePos };
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch {}
}
function animateTo(x, y, dur) {
  clearInterval(animTimer);
  const from = win.getBounds();
  const steps = Math.max(10, Math.round(dur / 16));
  let i = 0;
  animTimer = setInterval(() => {
    i++;
    const t = i / steps;
    const e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2) / 2; // easeInOutQuad
    setPos(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    if (i >= steps) { clearInterval(animTimer); animTimer = null; }
  }, 16);
}
function openDock() {
  if (mode !== 'edge' || !win || dockOpen) return;
  dockOpen = true;
  notifyRendererDock();
  const p = edgePositions();
  animateTo(p.x, p.y, 240);
}
function closeDock() {
  if (mode !== 'edge' || !win || !dockOpen) return;
  dockOpen = false;
  notifyRendererDock();
  const p = edgePositions();
  animateTo(p.x, p.y, 200);
}
// 边框模式手动拖拽：主进程轮询鼠标位置移动窗口，x 恒为贴边位置、只动 y（上下边则只动 x），并把位置夹在屏幕内防止被 Windows 撑大
let dragPoll = null, dragStart = null;
function stopDragPoll() {
  if (dragPoll) { clearInterval(dragPoll); dragPoll = null; }
  dragStart = null;
  userMoving = false;
}
function startDragPoll() {
  if (!win) return;
  stopDragPoll();
  const b = win.getBounds();
  const cp = screen.getCursorScreenPoint();
  dragStart = { cx: cp.x, cy: cp.y, wx: b.x, wy: b.y, lastX: cp.x, lastY: cp.y, lastT: Date.now() };
  userMoving = true;
  dragPoll = setInterval(() => {
    if (!win) { stopDragPoll(); return; }
    const cp = screen.getCursorScreenPoint();
    // 光标停住超过 700ms → 视为拖拽结束（防止收不回去）
    if (cp.x === dragStart.lastX && cp.y === dragStart.lastY) {
      if (Date.now() - dragStart.lastT > 700) { stopDragPoll(); return; }
    } else {
      dragStart.lastX = cp.x; dragStart.lastY = cp.y; dragStart.lastT = Date.now();
    }
    const dx = cp.x - dragStart.cx, dy = cp.y - dragStart.cy;
    const wa = screen.getPrimaryDisplay().workArea;
    const L = wa.x, R = wa.x + wa.width, T = wa.y, B = wa.y + wa.height;
    if (dockEdge === 'right' || dockEdge === 'left') {
      const y = Math.max(T, Math.min(B - WIN_H, dragStart.wy + dy)); // 夹在屏幕内，防撑大
      edgePos = y;
      const p = edgePositions();
      setPos(p.x, y); // x 恒为贴边位置，只动 y
    } else {
      const x = Math.max(L, Math.min(R - WIN_W, dragStart.wx + dx));
      edgePos = x;
      const p = edgePositions();
      setPos(x, p.y); // y 恒为贴边位置，只动 x
    }
    saveModeState();
  }, 16);
}
function dockTick() {
  if (!win || mode !== 'edge') return;
  // 到期前 5h：钉住，保持展开
  if (pinned && !dockOpen) openDock();
}
setInterval(dockTick, 200);

/* ── 前台窗口监控：手账只在“桌面”显示，用其他应用时整窗隐藏（含小把手） ── */
function fgLog(m) {
  try {
    const p = path.join(app.getPath('userData'), 'fg.log');
    fs.appendFileSync(p, new Date().toISOString() + ' ' + m + '\n');
  } catch {}
}
function checkForeground() {
  if (!win || win.isDestroyed()) return;
  if (pinnedToDesktop) return; // 已在桌面层，天然被其他窗口盖住
  execFile(FG_CHECK, [], { windowsHide: true, timeout: 2000 }, (err, stdout) => {
    if (!win || win.isDestroyed()) return;
    if (err) { fgLog('ERR ' + err.code + ' ' + err.message); return; }
    lastFgClass = (stdout || '').trim();
    if (win.isFocused()) { fgLog('fg=' + lastFgClass + ' focused'); return; }
    if (DESKTOP_CLASSES.has(lastFgClass)) {
      if (!win.isVisible()) { fgLog('fg=' + lastFgClass + ' show'); win.showInactive(); }
    } else if (lastFgClass && lastFgClass !== 'NONE') {
      if (win.isVisible()) { fgLog('fg=' + lastFgClass + ' hide'); win.hide(); }
    } else {
      fgLog('fg=' + lastFgClass + ' noop');
    }
  });
}
function startFgPoll() {
  if (fgTimer) return;
  fgTimer = setInterval(checkForeground, 1000); // 每秒确认一次前台窗口
}
function stopFgPoll() {
  if (fgTimer) { clearInterval(fgTimer); fgTimer = null; }
}

// 把窗口挂到桌面层（壁纸层）：任何应用 / 全屏都会自然盖住它，回到桌面自动露出，无闪烁
function pinToDesktop() {
  if (!win || win.isDestroyed()) return;
  try {
    const buf = win.getNativeWindowHandle();
    const hwnd = buf.readBigUInt64LE(0).toString();
    execFile(PIN_TO_DESKTOP, [hwnd], { windowsHide: true, timeout: 5000 }, (err) => {
      if (err) { fgLog('pin err ' + err.message + ' → 回退轮询'); startFgPoll(); }
      else { pinnedToDesktop = true; fgLog('已挂载到桌面层'); }
    });
  } catch (e) { fgLog('pin ex ' + e.message + ' → 回退轮询'); startFgPoll(); }
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    frame: false,                 // 无边框
    transparent: true,            // 半透明
    backgroundColor: '#00000000',
    alwaysOnTop: false,           // 挂载到桌面层后不需要置顶（置顶会盖住其他窗口）
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,            // 不占任务栏
    hasShadow: false,             // 阴影交给 CSS，避免矩形黑影
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // 诊断：把渲染进程报错转发到主进程控制台
  win.webContents.on('console-message', (event) => {
    console.log('[renderer]', event.message);
  });

  // 鼠标松开 → 结束拖拽（主进程可靠检测，保证拖完能收起）
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'mouseUp' && input.button === 'left') stopDragPoll();
  });

  win.once('ready-to-show', () => {
    const wa = screen.getPrimaryDisplay().workArea;
    if (mode === 'edge') {
      dockOpen = false; // 启动即收进边框，鼠标移上去再抽出
      applyEdgeState();
    } else {
      setPos(wa.x + wa.width - WIN_W - GAP, wa.y + 28);
    }
    pinToDesktop();               // 挂到桌面层；失败时自动回退到前台轮询
  });

  // 从手账切到其他应用 → 立即隐藏整窗（含小把手）；回到桌面由轮询自动显示
  win.on('blur', () => {
    if (pinnedToDesktop) return; // 桌面层窗口被盖住即可，无需隐藏
    if (win && !win.isDestroyed() && win.isVisible()) checkForeground();
    startFgPoll();
  });
  // 正在操作手账时暂停前台检测，进一步省资源
  win.on('focus', () => stopFgPoll());

  win.on('closed', () => { win = null; });
}

/* ── 代码自更新：main.js 变化时手账自动重启（无需外部杀进程 / 审批） ── */
let updating = false; // 内存标记防重入，不污染环境变量（避免新进程继承后自更新失效）
try {
  fs.watch(__dirname, { persistent: false }, (evt, fname) => {
    if (fname !== 'main.js' || updating) return;
    updating = true;
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 300);
  });
} catch {}
