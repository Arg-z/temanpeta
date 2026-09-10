import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      // changeOrigin: false itu WAJIB di sini. server/src/index.js menolak
      // permintaan yang Origin-nya tidak sama dengan header Host (proteksi
      // CSRF). Shorthand string ala Vite ('/api': 'http://...') dipaksa
      // changeOrigin: true sehingga Host ditulis ulang ke target, dan semua
      // POST/PATCH/DELETE dari dev lokal gagal 403 "Origin tidak diizinkan".
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/ws': { target: 'ws://localhost:3000', ws: true, changeOrigin: false },
    },
  },
});
