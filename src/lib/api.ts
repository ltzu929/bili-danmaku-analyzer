// 动态 API 基础地址
let dynamicApiBase = '';

// 初始化 API 基础地址
const initApiBase = async () => {
  try {
    // 优先尝试从 Electron 上下文获取动态端口
    if ((window as any).serverConfig?.getPort) {
      const port = await (window as any).serverConfig.getPort();
      if (port) {
        dynamicApiBase = `http://127.0.0.1:${port}`;
        console.log('API Base initialized:', dynamicApiBase);
        return;
      }
    }
  } catch (e) {
    console.warn('Failed to get dynamic API port, falling back to default.', e);
  }
  
  // 回退到默认值 (window.API_BASE 是 preload 中硬编码的 http://127.0.0.1:3001)
  dynamicApiBase = (window as any).API_BASE || 'http://127.0.0.1:3001';
};

// 立即触发初始化（非阻塞）
initApiBase();

export const apiUrl = (p: string) => {
  // 如果还未初始化完成，暂时使用默认值 (3001)，或者最好确保调用前已初始化
  // 由于我们无法将 apiUrl 变为异步，这里依赖 initApiBase 尽快完成
  // 大多数情况下，页面加载和用户交互之间的时间足够完成 IPC 通信
  const base = dynamicApiBase || (window as any).API_BASE || 'http://127.0.0.1:3001';
  return `${base}${p}`;
};

export const apiFetch = async (p: string, init?: RequestInit) => {
  // 确保在请求前尝试初始化一次（如果为空）
  if (!dynamicApiBase) {
    await initApiBase();
  }
  return fetch(apiUrl(p), init);
};