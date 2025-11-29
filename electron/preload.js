const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('API_BASE', 'http://127.0.0.1:3001')
contextBridge.exposeInMainWorld('updater', {
  check: () => ipcRenderer.send('update-check'),
  install: () => ipcRenderer.send('update-install'),
  on: (event, cb) => ipcRenderer.on(`update-${event}`, (_e, payload) => cb && cb(payload))
})
contextBridge.exposeInMainWorld('dialogs', {
  chooseDir: () => ipcRenderer.invoke('choose-dir')
})

// 在主世界中暴露 electronStore API
contextBridge.exposeInMainWorld('electronStore', {
  // 异步获取历史记录
  getHistory: () => ipcRenderer.invoke('get-history'),
  // 发送历史记录以供保存
  setHistory: (history) => ipcRenderer.send('set-history', history),
});
