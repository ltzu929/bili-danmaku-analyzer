const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('API_BASE', 'http://localhost:3001')
contextBridge.exposeInMainWorld('updater', {
  check: () => ipcRenderer.send('update-check'),
  install: () => ipcRenderer.send('update-install'),
  on: (event, cb) => ipcRenderer.on(`update-${event}`, (_e, payload) => cb && cb(payload))
})
contextBridge.exposeInMainWorld('dialogs', {
  chooseDir: () => ipcRenderer.invoke('choose-dir')
})
