import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import path from 'path'
import fs from 'fs'

// Local dev only: Vite's own dev server (default :5173) proxies /api/* and
// /data/* to the existing node dev-server.js (PORT env there defaults to
// 3000), which already wraps api/analyze-menu.js / api/translate-dish.js
// and serves data/generated/*.json exactly as Vercel would in production.
// This keeps the Package 2/3 server contract untouched — the React app
// never needs a separate backend.

// Copies ../data/generated into dist/data/generated at build time, so the
// production bundle is self-contained (same files Vercel would serve from
// the repo root today) instead of only working through the dev proxy.
function copyGeneratedData(): Plugin {
  return {
    name: 'copy-generated-data',
    closeBundle() {
      const src = path.resolve(import.meta.dirname, '../data/generated')
      const dest = path.resolve(import.meta.dirname, 'dist/data/generated')
      fs.mkdirSync(dest, { recursive: true })
      for (const file of fs.readdirSync(src)) {
        if (file.endsWith('.json')) {
          fs.copyFileSync(path.join(src, file), path.join(dest, file))
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyGeneratedData()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@shared': path.resolve(import.meta.dirname, '../shared'),
    },
  },
  // shared/*.js is plain UMD CommonJS (so dev-server.js/api/*.js can
  // `require()` it unmodified) — `vite build`'s Rollup pipeline already
  // converts that to ESM automatically, but Vite's *dev* server only does
  // the same CJS->ESM interop for files it pre-bundles via optimizeDeps
  // (normally just node_modules packages). Listing these here gets the
  // same interop in dev without touching shared/*.js itself.
  optimizeDeps: {
    include: ['@shared/allergens.js', '@shared/food-knowledge.js'],
  },
  // [Package 5] `vite preview` (production bundle) gets the same proxy, so
  // the built app can be smoke-tested locally against dev-server.js.
  preview: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/data': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  server: {
    // shared/*.js lives one directory above this Vite project's root
    // (web/) — allow the dev server to read it (otherwise Vite refuses to
    // serve files outside its root for security).
    fs: {
      allow: [path.resolve(import.meta.dirname, '..')],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/data': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
