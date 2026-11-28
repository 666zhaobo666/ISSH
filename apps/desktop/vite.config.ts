import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tauriConf from './src-tauri/tauri.conf.json';

// 单一版本源：src-tauri/tauri.conf.json 的 version 字段。
// 构建时注入 __APP_VERSION__，前端更新检测的"当前版本"永远与安装包一致，避免版本号漂移。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(tauriConf.version ?? '0.0.0'),
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
