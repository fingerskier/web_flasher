import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

const page = path => fileURLToPath(new URL(path, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  // Relative, so the build works under any GitHub Pages project path.
  base: './',
  plugins: [
    react(),
    {
      name: 'development-csp',
      apply: 'serve',
      // Vite's dev-only inline refresh script and WebSocket need a relaxed policy.
      // The built pages retain the strict, self-hosted policy in their HTML.
      transformIndexHtml: html => html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
    },
  ],
  build: {
    rollupOptions: {
      input: {
        home: page('./index.html'),
        rp2040: page('./rp2040/index.html'),
        espMosaico: page('./esp-mosaico/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
