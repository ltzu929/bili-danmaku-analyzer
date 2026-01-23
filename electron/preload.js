const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('updater', {
  check: () => ipcRenderer.send('update-check'),
  install: () => ipcRenderer.send('update-install'),
  on: (event, cb) => ipcRenderer.on(`update-${event}`, (_e, payload) => cb && cb(payload))
})

contextBridge.exposeInMainWorld('dialogs', {
  chooseDir: () => ipcRenderer.invoke('choose-dir')
})

// 通用 API 调用接口
contextBridge.exposeInMainWorld('api', {
  invoke: (channel, data) => ipcRenderer.invoke(channel, data)
});
