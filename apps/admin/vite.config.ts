import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 1421,
    proxy: {
      '/api': 'http://localhost:8080',
      '/avatars': 'http://localhost:8080',
    },
  },
});
