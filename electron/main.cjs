const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const { autoUpdater } = require('electron-updater')

require(path.join(__dirname, '../api/server.js'))

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
  const indexPath = path.join(__dirname, '../dist/index.html')
  win.loadFile(indexPath)
}

app.whenReady().then(() => {
  createWindow()
  autoUpdater.checkForUpdatesAndNotify()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

autoUpdater.on('checking-for-update', () => sendToAll('update-checking', {}))
autoUpdater.on('update-available', info => sendToAll('update-available', info))
autoUpdater.on('update-not-available', info => sendToAll('update-none', info))
autoUpdater.on('download-progress', progress => sendToAll('update-progress', progress))
autoUpdater.on('update-downloaded', info => sendToAll('update-downloaded', info))
autoUpdater.on('error', err => sendToAll('update-error', { message: err && err.message }))

ipcMain.on('update-check', () => {
  autoUpdater.checkForUpdates()
})

ipcMain.on('update-install', () => {
  autoUpdater.quitAndInstall()
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
