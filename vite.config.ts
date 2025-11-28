import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  // 解决 Electron 以 file:// 协议加载页面时的资源路径问题
  // 使用相对路径，避免生成的 index.html 引用以 / 开头的绝对路径导致白屏
  base: './',
  build: {
    sourcemap: 'hidden',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path
      }
    }
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    tsconfigPaths()
  ],
})
