/* ═══════════ 手帐待办 · 渲染进程逻辑 ═══════════ */
const HOUR = 3600e3, DAY = 24*HOUR, REMIND_MS = 12*HOUR;
const $ = id => document.getElementById(id);
const note = $('note'), list = $('list'), hdWarn = $('hdWarn'), hdPin = $('hdPin');

let tasks = [];

/* ─────────── 数据持久化 ─────────── */
let saveTimer = null;
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (window.api) window.api.saveTasks(tasks); }, 200);
}

function endOfDay(offset){
  const d = new Date(); d.setHours(23,0,0,0);
  d.setDate(d.getDate() + offset);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); // 已过 23 点则顺延一天
  return d.getTime();
}

function nextOccur(recur, now, after){
  let d = new Date(now); d.setHours(23,0,0,0);
  if (recur === 'daily'){
    if (d.getTime() <= now) d.setDate(d.getDate()+1);
  } else {
    const day = d.getDay(); // 0=周日
    d.setDate(d.getDate() + ((7-day)%7));
    if (d.getTime() <= now) d.setDate(d.getDate()+7);
  }
  if (after){ while (d.getTime() <= after) d.setDate(d.getDate() + (recur==='daily'?1:7)); }
  return d.getTime();
}

function seed(){
  const now = Date.now();
  return [
    { id:'s1', text:'完成日报',     prio:'mid', dueMs: now+8*HOUR,       total:8*HOUR,  recur:null,   done:false, completedAt:null, notified:false },
    { id:'s2', text:'喝两升水',     prio:'',   dueMs: nextOccur('daily', now),   total:DAY,     recur:'daily', done:false, completedAt:null, notified:false },
    { id:'s3', text:'给朋友回消息', prio:'low', dueMs: nextOccur('weekly', now),  total:7*DAY,   recur:'weekly',done:false, completedAt:null, notified:false },
    { id:'s4', text:'整理书桌',     prio:'hi',  dueMs: now+26*HOUR,      total:26*HOUR, recur:null,   done:false, completedAt:null, notified:false },
  ];
}

/* ─────────── 渲染 ─────────── */
function chipInfo(t){
  if (t.recur){
    if (t.done) return { cls:'back', html: t.recur==='daily' ? '↻ 明天再来' : '↻ 下周再来' };
    const wd = '周'+['日','一','二','三','四','五','六'][new Date(t.dueMs).getDay()];
    return { cls:'recur', html: t.recur==='daily' ? '↻ 每天 23:00' : '↻ '+wd+' 23:00' };
  }
  if (t.dueMs===null) return null;
  const rem = t.dueMs - Date.now();
  if (rem <= 0) return { cls:'over', html:'已逾期' };
  if (rem < PIN_MS) return { cls:'urgent', html:'剩 <b>'+Math.max(1,Math.ceil(rem/HOUR))+'</b>h', urgent:true }; // <5h 红
  if (rem < DAY) return { cls:'yellow', html:'剩 <b>'+Math.max(1,Math.ceil(rem/HOUR))+'</b>h' };                  // <1天 黄
  return { cls:'', html:'剩 <b>'+Math.floor(rem/DAY)+'</b>天' };
}

// 状态点颜色：完成=绿（重要完成=红）→ <5h 不收起=红 → <1天=黄 → 重要=红 → 中=琥珀 → 低=绿
function dotClass(t, rem){
  if (t.done) return t.prio==='hi' ? 's-red' : 's-green';
  if (rem !== null && rem < PIN_MS) return 's-red';
  if (rem !== null && rem < DAY) return 's-yellow';
  if (t.prio === 'hi') return 's-red';
  if (t.prio === 'mid') return 's-amber';
  if (t.prio === 'low') return 's-green';
  return '';
}

function render(anim){
  const oldPos = new Map();
  if (anim) list.querySelectorAll('.row').forEach(r => oldPos.set(r.dataset.id, r.getBoundingClientRect()));

  list.innerHTML='';
  const act = tasks.filter(t=>!t.done), done = tasks.filter(t=>t.done);
  [...act, ...done].forEach(t=>{
    const c = chipInfo(t);
    const rem = t.dueMs ? t.dueMs - Date.now() : null;

    const row = document.createElement('div');
    row.className = 'row p-'+(t.prio||'low') + (t.done?' done':'') + (c&&c.urgent?' urgent':'');
    row.dataset.id = t.id;

    const cb = document.createElement('span'); cb.className='cb';
    cb.innerHTML = '<svg viewBox="0 0 14 14"><path d="M3 7.5 L6 10.5 L11 4" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    cb.onclick = () => { const c2 = !t.done; t.done = c2; t.notified = true; if (c2) t.completedAt = Date.now(); else t.completedAt = null; save(); render(true); };

    const del = document.createElement('span'); del.className='del'; del.textContent='✕';
    del.title='删除'; del.onclick = () => { tasks = tasks.filter(x=>x.id!==t.id); save(); render(true); };

    const pdot = document.createElement('span'); pdot.className = 'pdot ' + dotClass(t, rem);
    const text = document.createElement('span'); text.className='text'; text.textContent=t.text;

    const due = document.createElement('span');
    if (c){ due.className='due '+c.cls; due.innerHTML=c.html; }

    row.append(cb, pdot, text, due, del);
    list.appendChild(row);
  });

  // 空状态
  const isEmpty = tasks.length === 0;
  list.style.display = isEmpty ? 'none' : '';
  $('empty').classList.toggle('show', isEmpty);

  if (anim){
    list.querySelectorAll('.row').forEach(r => {
      const o = oldPos.get(r.dataset.id);
      if (!o){ r.classList.add('in'); setTimeout(()=>r.classList.remove('in'), 400); return; }
      const n = r.getBoundingClientRect();
      const dx = o.left - n.left, dy = o.top - n.top;
      if (Math.abs(dx)>.5 || Math.abs(dy)>.5){
        r.style.transform = 'translate('+dx+'px,'+dy+'px)';
        requestAnimationFrame(() => {
          r.style.transition = 'transform .5s cubic-bezier(.25,.7,.3,1)';
          r.style.transform = '';
          r.addEventListener('transitionend', ()=>{ r.style.transition=''; }, {once:true});
        });
      }
    });
  }

  updatePin();
}

/* ─────────── 头部日期 ─────────── */
function paintDate(){
  const d = new Date();
  $('dateStr').innerHTML = (d.getMonth()+1)+'月'+d.getDate()+'日 <em>'+d.toLocaleDateString('zh-CN',{weekday:'short'})+'</em>';
}
paintDate();

/* ─────────── 快速添加 ─────────── */
const input = $('input');
let pending = {};
let inputFocused = false;
input.addEventListener('focus', () => { inputFocused = true; });
input.addEventListener('blur', () => { inputFocused = false; });
$('addBtn').onclick = () => { if (note.classList.toggle('adding')) setTimeout(()=>input.focus(),50); };

$('addbox').querySelectorAll('.chip').forEach(ch=>{
  ch.onclick = () => {
    if (ch.id === 'chipCal') return; // 自定义日期单独处理
    const key = ch.dataset.prio ? 'prio' : (ch.dataset.recur ? 'recur' : 'days');
    const val = ch.dataset.prio || ch.dataset.recur || +ch.dataset.days;
    if (pending[key]===val) delete pending[key]; else pending[key]=val;
    $('addbox').querySelectorAll('.chip').forEach(x=>x.classList.toggle('on', x===ch && pending[key]===val));
    input.focus(); // 点完标签焦点回输入框，回车可直接添加
  };
});

/* 自定义日期日历：点 📅 选日期，截止到所选当天 23:00 */
const calendar = $('calendar');
const chipCal = $('chipCal');
let calYear, calMonth;
function renderCalendar(){
  $('calTitle').textContent = calYear + '年' + (calMonth+1) + '月';
  const grid = $('calGrid');
  grid.innerHTML = '';
  const now = new Date();
  const startDow = (new Date(calYear, calMonth, 1).getDay() + 6) % 7; // 周一开头
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  for (let i=0;i<startDow;i++){ const b=document.createElement('div'); b.className='cal-day blank'; grid.appendChild(b); }
  for (let d=1; d<=daysInMonth; d++){
    const el = document.createElement('div');
    el.className = 'cal-day';
    el.textContent = d;
    if (d===now.getDate() && calMonth===now.getMonth() && calYear===now.getFullYear()) el.classList.add('today');
    if (pending.dateMs){
      const pd = new Date(pending.dateMs);
      if (pd.getFullYear()===calYear && pd.getMonth()===calMonth && pd.getDate()===d) el.classList.add('picked');
    }
    el.onclick = () => {
      pending.dateMs = new Date(calYear, calMonth, d, 23, 0, 0).getTime(); // 当天 23:00 前完成
      chipCal.textContent = (calMonth+1)+'月'+d+'日';
      chipCal.classList.add('on');
      calendar.classList.remove('show');
    };
    grid.appendChild(el);
  }
}
function openCalendar(){
  const base = pending.dateMs ? new Date(pending.dateMs) : new Date();
  calYear = base.getFullYear();
  calMonth = base.getMonth();
  renderCalendar();
  calendar.classList.add('show');
}
chipCal.onclick = e => { e.stopPropagation(); openCalendar(); };
$('calPrev').onclick = () => { calMonth--; if(calMonth<0){calMonth=11;calYear--;} renderCalendar(); };
$('calNext').onclick = () => { calMonth++; if(calMonth>11){calMonth=0;calYear++;} renderCalendar(); };
$('calClear').onclick = () => {
  pending.dateMs = null;
  chipCal.textContent = '选日期';
  chipCal.classList.remove('on');
  calendar.classList.remove('show');
};
document.addEventListener('pointerdown', e => {
  if (!calendar.contains(e.target) && e.target.id !== 'chipCal') calendar.classList.remove('show');
});

function submitAdd(){
  if (!input.value.trim()) return;
  let text = input.value, prio=null, days=null;
  if (/\s*!!/.test(text)){ prio='hi'; text=text.replace(/\s*!!/,''); }
  if (text.includes('!')){ prio='hi'; text=text.replace(/!/g,''); }
  if (text.includes('重要')){ prio='hi'; text=text.replace(/重要/g,''); }
  if (text.includes('明天')){ days=1; text=text.replace(/明天/g,''); }
  else if (text.includes('今天')||text.includes('今晚')){ days=0; text=text.replace(/今天|今晚/g,''); }
  const m = text.match(/(\d+)\s*天后?/); if (m){ days=+m[1]; text=text.replace(m[0],''); }

  const recur = pending.recur || null;
  const finalPrio = prio || pending.prio || 'low';
  let dueMs = null;
  if (recur){ dueMs = nextOccur(recur, Date.now()); }
  else if (pending.dateMs){ dueMs = pending.dateMs; } // 日历自定义日期
  else if (days!==null || pending.days!==undefined){
    const dv = days!==null ? days : pending.days;
    dueMs = endOfDay(dv); // 今天/明天/3天后 → 当天 23:00 截止
  }

  tasks.unshift({ id:'t'+Date.now()+Math.floor(Math.random()*999), text:text||'未命名任务', prio:finalPrio, dueMs, total: dueMs?Math.abs(dueMs-Date.now()):0, recur, done:false, completedAt:null, notified:false });
  pending={}; input.value=''; resetChips();
  save(); render(true);
  input.focus();
}

input.addEventListener('keydown', e=>{
  if (e.key==='Escape'){ note.classList.remove('adding'); input.value=''; pending={}; resetChips(); return; }
  if (e.key==='Enter') submitAdd();
});

// 焦点不在输入框时（如刚点过标签）按回车也能直接添加
document.addEventListener('keydown', e=>{
  if (e.key==='Enter' && note.classList.contains('adding') && document.activeElement !== input) submitAdd();
});

function resetChips(){
  $('addbox').querySelectorAll('.chip').forEach(x=>x.classList.remove('on'));
  pending.dateMs = null;
  const cc = $('chipCal');
  if (cc) cc.textContent = '选日期';
}

/* ─────────── ⋯ 菜单 ─────────── */
const menu = $('menu');
$('menuBtn').onclick = e => { e.stopPropagation(); menu.classList.toggle('show'); };
document.addEventListener('pointerdown', e=>{
  if (!menu.contains(e.target) && e.target.id!=='menuBtn') menu.classList.remove('show');
});
window.addEventListener('blur', () => menu.classList.remove('show')); // 点击窗口外也收回
$('mLogin').onclick = async () => {
  const cur = await (window.api ? window.api.getLogin() : false);
  if (window.api) window.api.setLogin(!cur);
  syncLogin(!cur);
  menu.classList.remove('show');
};
async function syncLogin(on){
  const cur = on !== undefined ? on : await (window.api ? window.api.getLogin() : false);
  $('loginState').textContent = cur ? '开' : '关';
  $('mLogin').classList.toggle('on', cur);
}
syncLogin();
// 贴边状态由主进程根据"拖到屏幕边缘"判定，这里只同步状态（显示左侧收起图案）
// 小把手只在"边框模式且收起"时显示，按贴边方向放在对应一侧
let currentMode = 'free', currentEdge = 'right';
function applyDockUI(s){
  currentMode = (s && s.mode) || 'free';
  currentEdge = (s && s.edge) || 'right';
  const docked = currentMode === 'edge';
  document.body.classList.toggle('dock', docked && !(s && s.open));
  document.body.classList.toggle('edge', docked); // 边框模式：头部改用手动拖拽
  ['right','left','top','bottom'].forEach(e => document.body.classList.toggle('dock-'+e, docked && currentEdge===e));
  const ms = $('modeState');
  if (ms){
    const dir = { left:'左', right:'右', top:'上', bottom:'下' }[currentEdge] || '';
    ms.textContent = docked ? ('开 · '+dir) : '关';
    $('mMode').classList.toggle('on', docked);
  }
}
if (window.api){
  window.api.modeGet().then(s => applyDockUI(s)).catch(()=>{});
  window.api.onDockState(s => applyDockUI(s));
}

/* 边框模式开关 */
$('mMode').onclick = async () => {
  const s = window.api ? await window.api.modeGet() : { mode:'free' };
  if (window.api) window.api.modeSet(s.mode === 'edge' ? 'free' : 'edge');
  menu.classList.remove('show');
};

/* 边框模式手动拖拽：x 锁死在贴边位置，只沿边移动 */
document.addEventListener('pointerdown', e => {
  if (e.button !== 0 || currentMode !== 'edge') return; // 自由模式用原生拖拽
  if (!(e.target.closest('.hd') || e.target.closest('.dragbar'))) return;
  if (e.target.closest('button, input')) return;
  try { document.body.setPointerCapture(e.pointerId); } catch {}
  if (window.api) window.api.dragStart();
});
document.addEventListener('pointerup', () => { if (window.api) window.api.dragEnd(); });
document.addEventListener('pointercancel', () => { if (window.api) window.api.dragEnd(); });

/* 鼠标进入/离开窗口 → 抽屉抽出 / 收起（浏览器原生事件，比轮询可靠） */
document.addEventListener('mouseenter', () => { if (window.api) window.api.dockEnter(); });
document.addEventListener('mouseleave', () => {
  if (!window.api) return;
  if (inputFocused) return; // 正在输入时不收起
  window.api.dragEnd();   // 若拖拽中还离开窗口，一并结束拖拽
  window.api.dockLeave();
});

/* 滚轮加速列表滚动 */
document.addEventListener('wheel', e => {
  const l = $('list');
  if (!l || l.scrollHeight <= l.clientHeight) return;
  e.preventDefault();
  l.scrollTop += e.deltaY * 2.5;
}, { passive: false });

/* 右侧小条点击 → 抽屉抽出贴紧 */
$('edgeTab').addEventListener('click', () => { if (window.api) window.api.dockEnter(); });
$('mQuit').onclick = () => { if (window.api) window.api.quit(); };

/* ─────────── 钉住机制：到期不足 24h → 贴边不收起，直到完成 ─────────── */
const PIN_MS = 5*HOUR; // 到期前 5 小时起钉住
let lastPinned = false;
function updatePin(){
  const now = Date.now();
  const n5h = tasks.filter(t => !t.done && t.dueMs !== null && (t.dueMs - now) <= PIN_MS).length;
  const n1d = tasks.filter(t => !t.done && t.dueMs !== null && (t.dueMs - now) <= DAY).length;
  const p = n5h > 0;
  if (p !== lastPinned){ lastPinned = p; if (window.api) window.api.pinSet(p); }
  hdWarn.textContent = n5h ? '⚠ '+n5h : '';   // 红：到达不收起条件(<5h)
  hdWarn.style.display = n5h ? '' : 'none';
  hdPin.textContent = n1d ? '◷ '+n1d : '';    // 黄：少于一天
  hdPin.style.display = n1d ? '' : 'none';
}

setInterval(updatePin, 30000); // 每 30 秒刷新钉住状态

/* ─────────── 次日自动清除已完成的一次性任务 ─────────── */
function pruneCompleted(){
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const before = tasks.length;
  tasks = tasks.filter(t => !(t.done && !t.recur && t.completedAt && t.completedAt < todayStart.getTime()));
  if (tasks.length !== before) save();
}
setInterval(pruneCompleted, 3600000); // 每小时

/* ─────────── 启动 ─────────── */
(async function init(){
  let saved = null;
  try { saved = window.api ? await window.api.loadTasks() : null; } catch {}
  if (saved && Array.isArray(saved)) tasks = saved;
  else tasks = seed();
  pruneCompleted();
  render();
  // 全局快捷键呼出输入框
  if (window.api) window.api.onShowAdd(() => { note.classList.add('adding'); setTimeout(()=>input.focus(),60); });
  // 启动后刷新钉住状态（示例任务 8h 内会立即钉住）
  setTimeout(updatePin, 1200);
})();
