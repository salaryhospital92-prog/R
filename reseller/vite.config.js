import { createReadStream, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join, normalize } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// التطوير فقط: يقدّم صور وشعارات تجريبية من dev/assets بدل التخزين الحي.
const ASSETS = fileURLToPath(new URL('./dev/assets', import.meta.url))
const TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
const devAssets = () => ({
  name: 'dev-assets',
  apply: 'serve',
  configureServer(s) {
    s.middlewares.use((req, res, next) => {
    const m = req.url.split('?')[0].match(/^\/(?:dev-img|api\/storage\/v1\/object\/public\/reseller-logos)\/(.+)$/)
    const file = m && normalize(join(ASSETS, decodeURIComponent(m[1])))
    if (!file || !file.startsWith(normalize(ASSETS)) || !existsSync(file)) return next()
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
    createReadStream(file).pipe(res)
    })
  },
})

// المتصفح يكلّم /api على نطاق المتجر فقط. في الإنتاج وكيل (Worker) يمرّره إلى القاعدة ويحقن المفتاح؛
// هنا يمرّ إلى PostgREST المحلي (dev/stack.mjs) بلا البادئة.
const API = process.env.DEV_API ?? 'http://127.0.0.1:3101'
export default defineConfig({
  plugins: [react(), tailwindcss(), devAssets()],
  server: {
    port: 5180,
    allowedHosts: ['.localhost'],
    proxy: { '/api/rest/v1': { target: API, rewrite: (p) => p.replace(/^\/api\/rest\/v1/, '') } },
  },
})
