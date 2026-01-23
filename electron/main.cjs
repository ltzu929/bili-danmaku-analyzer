const { app, BrowserWindow, ipcMain, dialog, session } = require('electron')
const path = require('path')
const { setupIPC } = require('./ipcHandlers.cjs')

let autoUpdater
try { ({ autoUpdater } = require('electron-updater')) } catch {}

// 初始化 IPC 业务逻辑
setupIPC();

function sendToAll(channel, payload) {
  BrowserWindow.getAllWindows().forEach(win => {
    try { win.webContents.send(channel, payload) } catch {}
  })
}

function createWindow () {
  const preloadPath = path.join(__dirname, 'preload.js');
  
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  // 配置请求头，解决 B 站图片防盗链问题
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.hdslb.com/*', '*://*.bilibili.com/*'] },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://www.bilibili.com/';
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  );

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      require('electron').shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  if (!app.isPackaged) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    console.log('Loading URL:', devUrl);
    win.loadURL(devUrl).catch(e => console.error('Failed to load dev URL:', e));
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html')
    win.loadFile(indexPath)
  }
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
