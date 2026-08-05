const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadTasks: () => ipcRenderer.invoke('tasks:load'),
  saveTasks: (data) => ipcRenderer.send('tasks:save', data),
  quit: () => ipcRenderer.send('app:quit'),
  hideWindow: () => ipcRenderer.send('win:hide'),
  showWindow: () => ipcRenderer.send('win:show'),
  resize: (w, h) => ipcRenderer.send('win:resize', w, h),
  getLogin: () => ipcRenderer.invoke('login:get'),
  setLogin: (on) => ipcRenderer.send('login:set', on),
  pinSet: (on) => ipcRenderer.send('pin:set', on),
  modeGet: () => ipcRenderer.invoke('mode:get'),
  modeSet: (m) => ipcRenderer.send('mode:set', m),
  dragStart: () => ipcRenderer.send('win:drag-start'),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  dockEnter: () => ipcRenderer.send('dock:enter'),
  dockLeave: () => ipcRenderer.send('dock:leave'),
  onDockState: (cb) => ipcRenderer.on('dock-state', (e, d) => cb(d)),
  onShowAdd: (cb) => ipcRenderer.on('show-add', () => cb())
});
