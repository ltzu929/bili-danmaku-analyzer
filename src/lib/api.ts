// 动态 API 基础地址
let dynamicApiBase = '';
let initPromise: Promise<void> | null = null;

// 初始化 API 基础地址
const initApiBase = () => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      console.log('Checking for serverConfig...', window.serverConfig);
      // 优先尝试从 Electron 上下文获取动态端口
      if (window.serverConfig?.getPort) {
        // 增加重试机制，确保主进程已就绪
        let port;
        for (let i = 0; i < 10; i++) { // 增加重试次数
          port = await window.serverConfig.getPort();
          console.log(`Attempt ${i + 1}: Got port`, port);
          if (port) break;
          await new Promise(r => setTimeout(r, 500)); // 等待 500ms 重试
        }

        if (port) {
          dynamicApiBase = `http://127.0.0.1:${port}`;
          console.log('API Base initialized:', dynamicApiBase);
          return;
        } else {
          console.error('Failed to get port from serverConfig after retries');
        }
      } else {
        console.warn('window.serverConfig is missing. Are you in Electron?');
      }
    } catch (e) {
      console.warn('Failed to get dynamic API port, falling back to default.', e);
    }
    
    // 回退到默认值
    dynamicApiBase = window.API_BASE || 'http://127.0.0.1:3001';
    console.log('Fallback to API base:', dynamicApiBase);
  })();

  return initPromise;
};

// 立即触发初始化
initApiBase();

export const apiUrl = (p: string) => {
  const base = dynamicApiBase || window.API_BASE || 'http://127.0.0.1:3001';
  return `${base}${p}`;
};

export const apiFetch = async (p: string, init?: RequestInit) => {
  if (!dynamicApiBase) {
    await initApiBase();
  }
  const url = apiUrl(p);
  // console.log('Fetching:', url); // 调试日志
  return fetch(url, init);
};