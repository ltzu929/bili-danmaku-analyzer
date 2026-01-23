export const apiUrl = (p: string) => {
  // 适配图片代理逻辑：直接返回原始 URL
  // 前端组件调用时通常是: apiUrl(`/api/cover?url=${encodeURIComponent(url)}`)
  if (p.startsWith('/api/cover') && p.includes('url=')) {
    const match = p.match(/url=([^&]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  // 对于其他情况，返回原始路径，供 apiFetch 内部路由使用
  return p;
};

export const apiFetch = async (path: string, init?: RequestInit) => {
  // 模拟 Response 对象，保持与 fetch API 兼容
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockResponse = (data: any) => ({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers()
  });

  const method = init?.method || 'GET';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  if (init?.body && typeof init.body === 'string') {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = {};
    }
  } else if (init?.body) {
    body = init.body;
  }

  // 解析路径和查询参数
  // 注意：apiUrl 可能已经处理过路径，但如果是 API 调用，path 通常是 /api/...
  const [urlPath, queryStr] = path.split('?');
  const query = new URLSearchParams(queryStr || '');
  const parts = urlPath.split('/').filter(p => p); // e.g. ['api', 'analyze']

  try {
    let result;
    const action = parts[1]; // analyze, danmaku, video, ...

    if (action === 'analyze' && method === 'POST') {
       result = await window.api.invoke('analyze', body);
    } 
    else if (action === 'danmaku') {
       if (parts[2] === 'search') {
         // /api/danmaku/search/:roomId/:date
         const roomId = parts[3];
         const date = parts[4];
         const keyword = query.get('keyword');
         result = await window.api.invoke('search-danmaku', { roomId, date, keyword });
       } else {
         // /api/danmaku/:roomId/:date
         const roomId = parts[2];
         const date = parts[3];
         result = await window.api.invoke('get-danmaku', { roomId, date });
       }
    } 
    else if (action === 'video') {
       // /api/video/:bvid
       const bvid = parts[2];
       result = await window.api.invoke('get-video-cover', bvid);
    } 
    else if (action === 'up-series') {
       result = await window.api.invoke('get-up-series', body);
    } 
    else if (action === 'history') {
       if (method === 'GET') result = await window.api.invoke('get-history');
       if (method === 'POST') result = await window.api.invoke('add-history', body);
       if (method === 'DELETE') result = await window.api.invoke('delete-history', { url: query.get('url') });
    } 
    else if (action === 'save-cover') {
       result = await window.api.invoke('save-cover', body);
    } 
    else if (action === 'system' && parts[2] === 'downloads-path') {
       result = await window.api.invoke('get-downloads-path');
    } 
    else if (action === 'cache' && method === 'DELETE') {
       result = await window.api.invoke('clear-cache');
    } 
    else {
       console.warn('Unknown API path:', path);
       return { ok: false, status: 404, json: async () => ({ error: 'Not Found' }) } as Response;
    }
    
    return mockResponse(result) as unknown as Response;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (e: any) {
    console.error('IPC Error:', e);
    // 构造错误响应
    return { 
        ok: false, 
        status: 500, 
        json: async () => ({ error: e.message || 'Internal Error' }) 
    } as Response;
  }
};
