// 动态 API 基础地址
let dynamicApiBase = '';
let initPromise: Promise<void> | null = null;

// 初始化 API 基础地址
const initApiBase = () => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // 优先尝试从 Electron 上下文获取动态端口
      if ((window as any).serverConfig?.getPort) {
        // 增加重试机制，确保主进程已就绪
        let port;
        for (let i = 0; i < 5; i++) {
          port = await (window as any).serverConfig.getPort();
          if (port) break;
          await new Promise(r => setTimeout(r, 500)); // 等待 500ms 重试
        }

        if (port) {
          dynamicApiBase = `http://127.0.0.1:${port}`;
          console.log('API Base initialized:', dynamicApiBase);
          return;
        }
      }
    } catch (e) {
      console.warn('Failed to get dynamic API port, falling back to default.', e);
    }
    
    // 回退到默认值
    dynamicApiBase = (window as any).API_BASE || 'http://127.0.0.1:3001';
  })();

  return initPromise;
};

// 立即触发初始化
initApiBase();

export const apiUrl = (p: string) => {
  const base = dynamicApiBase || (window as any).API_BASE || 'http://127.0.0.1:3001';
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