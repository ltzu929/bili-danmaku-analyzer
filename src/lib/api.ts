export const apiBase = (window as any).API_BASE || ''
export const apiUrl = (p: string) => `${apiBase}${p}`
export const apiFetch = (p: string, init?: RequestInit) => fetch(apiUrl(p), init)