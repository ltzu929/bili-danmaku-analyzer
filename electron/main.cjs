const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
let autoUpdater
try { ({ autoUpdater } = require('electron-updater')) } catch {}

(async () => {
  try {
    const url = pathToFileURL(path.join(__dirname, '../api/server.js')).href
    await import(url)
    console.log('backend started')
  } catch (e) {
    console.error('backend start failed', e && e.message)
  }
})()

function sendToAll(channel, payload) {
  BrowserWindow.getAllWindows().forEach(win => {
    try { win.webContents.send(channel, payload) } catch {}
  })
}

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      require('electron').shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  const indexPath = path.join(__dirname, '../dist/index.html')
  win.loadFile(indexPath)
}

app.whenReady().then(() => {
  createWindow()
  if (autoUpdater && typeof autoUpdater.checkForUpdatesAndNotify === 'function') {
    autoUpdater.checkForUpdatesAndNotify()
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

if (autoUpdater) {
  autoUpdater.on('checking-for-update', () => sendToAll('update-checking', {}))
  autoUpdater.on('update-available', info => sendToAll('update-available', info))
  autoUpdater.on('update-not-available', info => sendToAll('update-none', info))
  autoUpdater.on('download-progress', progress => sendToAll('update-progress', progress))
  autoUpdater.on('update-downloaded', info => sendToAll('update-downloaded', info))
  autoUpdater.on('error', err => sendToAll('update-error', { message: err && err.message }))
}

ipcMain.on('update-check', () => {
  if (autoUpdater && typeof autoUpdater.checkForUpdates === 'function') {
    autoUpdater.checkForUpdates()
  } else {
    sendToAll('update-error', { message: 'updater disabled' })
  }
})

ipcMain.on('update-install', () => {
  if (autoUpdater && typeof autoUpdater.quitAndInstall === 'function') {
    autoUpdater.quitAndInstall()
  }
})

ipcMain.handle('choose-dir', async () => {
  try {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { path: '' }
    return { path: result.filePaths[0] }
  } catch {
    return { path: '' }
  }
})

// 处理 get-history 事件
ipcMain.handle('get-history', async () => {
  // 从 store 中获取历史记录，默认为一个空对象
  return store.get('history', {});
});

// 处理 set-history 事件
ipcMain.on('set-history', (event, history) => {
  // 将历史记录设置到 store 中
  store.set('history', history);
});
