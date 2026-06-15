import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../hub/static_dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:5000', ws: true },
    },
  },
})
