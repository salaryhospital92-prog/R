import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// المتصفح يكلّم /api على نطاق الصفحة فقط. في الإنتاج وكيل (Worker) يمرّره إلى القاعدة ويحقن المفتاح؛
// هنا يمرّ إلى PostgREST المحلي (dev/stack.mjs) بلا البادئة.
const API = process.env.DEV_API ?? 'http://127.0.0.1:3101'
const AUTH = process.env.DEV_AUTH ?? 'http://127.0.0.1:3102'      // GoTrue المحلي
const ASSETS = fileURLToPath(new URL('./dev/assets', import.meta.url))
const SECRETS = fileURLToPath(new URL('./dev/.secrets.json', import.meta.url))
const TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))) })

// =====================================================================
// التطوير فقط (apply: 'serve'): لا يدخل البناء ولا الإنتاج.
//  1) صور وشعارات تجريبية من dev/assets، ورفع الشعار إليها (بدل تخزين Supabase)
//  2) /dev/telegram/auto يلعب دور تيليغرام: يرسل التحديثات إلى دالة الويبهوك الحقيقية في القاعدة بسرّ التجربة
// الدخول نفسه حقيقي: دوال القاعدة + GoTrue (/api/auth/v1) كما في الإنتاج.
// =====================================================================
const devOnly = () => ({
  name: 'dev-only', apply: 'serve',
  configureServer(s) {
    // رسالة تيليغرام تجريبية إلى الويبهوك؛ الرد (webhook reply) هو رسالة البوت
    const hook = async (update) => {
      const { anon, hook } = JSON.parse(readFileSync(SECRETS, 'utf8'))
      const r = await fetch(`${API}/rpc/reseller_bot_webhook`, {
        method: 'POST', body: JSON.stringify(update),
        headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}`, 'X-Telegram-Bot-Api-Secret-Token': hook },
      })
      return r.json()
    }
    s.middlewares.use(async (req, res, next) => {
      const url = req.url.split('?')[0]
      try {
        // زر التجربة في صفحة الدخول: خطوات تيليغرام كلها (Start، الرقم، جهة الاتصال)
        if (url === '/dev/telegram/auto' && req.method === 'POST') {
          const { tg, number, nonce } = JSON.parse((await body(req)).toString())
          const from = { id: +tg, first_name: +tg === 111 ? 'علي' : 'مروّج جديد' }, chat = { id: +tg, type: 'private' }
          const out = [await hook({ message: { from, chat, text: `/start login_${nonce}` } })]
          out.push(await hook({ callback_query: { id: '1', from, message: { chat }, data: `lp:${nonce}:${number}` } }))
          if (out[1].reply_markup?.keyboard) out.push(await hook({ message: { from, chat, contact: { phone_number: `+96477000${String(tg).padStart(5, '0')}`, user_id: +tg } } }))
          res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(out.map((m) => m.text)))
        }
        // رفع الشعار: POST/PUT /api/storage/v1/object/reseller-logos/<path>
        const up = url.match(/^\/api\/storage\/v1\/object\/reseller-logos\/(.+)$/)
        if (up && ['POST', 'PUT'].includes(req.method)) {
          const file = normalize(join(ASSETS, decodeURIComponent(up[1])))
          if (!file.startsWith(normalize(ASSETS))) return next()
          mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, await body(req))
          res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ Key: `reseller-logos/${up[1]}` }))
        }
        // صور وشعارات
        const m = url.match(/^\/(?:dev-img|api\/storage\/v1\/object\/public\/reseller-logos)\/(.+)$/)
        const file = m && normalize(join(ASSETS, decodeURIComponent(m[1])))
        if (!file || !file.startsWith(normalize(ASSETS)) || !existsSync(file)) return next()
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(file).pipe(res)
      } catch (e) { res.statusCode = 500; res.end(String(e?.message ?? e)) }
    })
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), devOnly()],
  build: { rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), panel: fileURLToPath(new URL('./panel/index.html', import.meta.url)) } } },
  server: {
    port: 5180,
    allowedHosts: ['.localhost'],
    proxy: {
      '/api/rest/v1': { target: API, rewrite: (p) => p.replace(/^\/api\/rest\/v1/, '') },
      '/api/auth/v1': { target: AUTH, rewrite: (p) => p.replace(/^\/api\/auth\/v1/, '') },
    },
  },
})
