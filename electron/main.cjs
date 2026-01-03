const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
let autoUpdater
try { ({ autoUpdater } = require('electron-updater')) } catch {}

let apiPort = 3001; // 默认端口

(async () => {
  try {
    const url = pathToFileURL(path.join(__dirname, '../api/server.js')).href
    const serverModule = await import(url)
    console.log('backend module loaded')
    
    // 调试日志：查看导出内容
    console.log('Server Module Exports:', Object.keys(serverModule));

    // 获取实际启动的端口
    if (serverModule.serverPromise) {
      apiPort = await serverModule.serverPromise;
      console.log(`Backend started on port: ${apiPort}`);
    } else {
      console.error('serverPromise not found in server module exports');
    }
  } catch (e) {
    console.error('backend start failed', e)
  }
})()

function sendToAll(channel, payload) {
  BrowserWindow.getAllWindows().forEach(win => {
    try { win.webContents.send(channel, payload) } catch {}
  })
}

function createWindow () {
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('Preload script path:', preloadPath); // 打印 preload 路径，验证是否正确

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true, // 确保开启
      nodeIntegration: false, // 确保关闭
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      require('electron').shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // 在开发环境下，加载 Vite 开发服务器地址
  // 在生产环境下，加载 dist/index.html
  // 注意：process.env.VITE_DEV_SERVER_URL 通常由 electron-vite 等插件注入，如果只是 concurrently 运行，可能需要手动判断
  // 这里我们简单判断是否是开发环境（app.isPackaged 为 false）
  if (!app.isPackaged) {
    // 尝试连接 Vite 默认端口，或者从环境变量获取
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    console.log('Loading URL:', devUrl);
    win.loadURL(devUrl).catch(e => console.error('Failed to load dev URL:', e));
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html')
    win.loadFile(indexPath)
  }
}

// 处理获取端口的请求
ipcMain.handle('get-api-port', () => {
  return apiPort;
});

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
