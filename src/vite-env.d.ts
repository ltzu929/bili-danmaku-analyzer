/// <reference types="vite/client" />

interface Window {
  api: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invoke: (channel: string, data?: any) => Promise<any>;
  };
  // 保留 updater 和 dialogs，因为它们还在使用
  updater?: {
    check: () => void;
    install: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on: (event: string, cb: (payload: any) => void) => void;
  };
  dialogs?: {
    chooseDir: () => Promise<{ path: string }>;
  };
}
