/// <reference types="vite/client" />

interface Window {
  serverConfig?: {
    getPort: () => Promise<number>;
  };
  API_BASE?: string;
  electronStore?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getHistory: () => Promise<Record<string, any>>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setHistory: (history: Record<string, any>) => void;
  };
}
