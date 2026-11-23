import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// المتصفح يكلّم /api على نطاق الصفحة فقط. في الإنتاج وكيل (Worker) يمرّره إلى القاعدة ويحقن المفتاح؛
// هنا يمرّ إلى PostgREST المحلي (dev/stack.mjs) بلا البادئة.
const API = process.env.DEV_API ?? 'http://127.0.0.1:3101'
const ASSETS = fileURLToPath(new URL('./dev/assets', import.meta.url))
const SECRETS = fileURLToPath(new URL('./dev/.secrets.json', import.meta.url))
const TYPES = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const sign = (p, secret) => { const h = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(p)}`; return `${h}.${createHmac('sha256', secret).update(h).digest('base64url')}` }
const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))) })

// =====================================================================
// التطوير فقط (apply: 'serve'): لا يدخل البناء ولا الإنتاج.
//  1) صور وشعارات تجريبية من dev/assets، ورفع الشعار إليها (بدل تخزين Supabase)
//  2) دالة الدخول reseller-login: المعالج الحقيقي نفسه (supabase/functions/reseller-login/handler.js) على القاعدة المحلية
//     — البديل المحاكى فقط: إنشاء مستخدم auth وإصدار الجلسة (في الإنتاج GoTrue)، وإرسال تيليغرام (يُحفظ في صندوق ولا يخرج)
//  3) /dev/telegram/*: يلعب دور تيليغرام: يستقبل تحديثاً (Start، ضغط زر، جهة اتصال) ويعيد ردود البوت
// =====================================================================
const devOnly = () => {
  let handler, outbox = [], lastNonce = null
  const secrets = () => JSON.parse(readFileSync(SECRETS, 'utf8'))
  const ensureUser = (email) => {
    if (!/^tg\d{1,15}@telegram\.invalid$/.test(email)) throw new Error('email')
    const sql = `with e as (select id from auth.users where email = '${email}'),
      i as (insert into auth.users (id, aud, role, email, email_confirmed_at, created_at) select gen_random_uuid(), 'authenticated', 'authenticated', '${email}', now(), now()
            where not exists (select 1 from e) returning id) select id from e union all select id from i`
    const r = spawnSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=local', 'reseller-dev-db', 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(r.stderr)
    return r.stdout.trim().split('\n')[0]
  }
  const make = async () => {
    const { makeHandler } = await import('../supabase/functions/reseller-login/handler.js')
    const { createClient } = await import('@supabase/supabase-js')
    const { secret, service } = secrets()
    // supabase-js يضيف /rest/v1؛ PostgREST المحلي بلا بادئة: نعيد كتابة العنوان
    const db = createClient('http://dev.invalid', service, { auth: { persistSession: false }, global: { fetch: (u, o) => fetch(String(u).replace('http://dev.invalid/rest/v1', API), o) } })
    const session = async (email) => {
      const id = ensureUser(email), exp = Math.floor(Date.now() / 1000) + 12 * 3600
      const access_token = sign({ aud: 'authenticated', role: 'authenticated', sub: id, email, exp, iss: 'reseller-dev' }, secret)
      return { userId: id, payload: { session: { access_token, refresh_token: 'dev-refresh', token_type: 'bearer', expires_in: 43200, expires_at: exp, user: { id, email } } } }
    }
    return makeHandler({ db, session, env: { BOT_USERNAME: 'dev_bot', WEBHOOK_SECRET: '' }, tg: async (method, payload) => { outbox.push({ method, payload }); return { ok: true } } })
  }
  const call = async (req, url, buf) => {
    handler ??= await make()
    return handler(new Request(`http://dev${url}`, { method: req.method, headers: { 'content-type': 'application/json' }, body: buf.length ? buf : undefined }))
  }
  const send = async (res, r) => { res.statusCode = r.status; res.setHeader('Content-Type', 'application/json'); res.end(await r.text()) }

  return {
    name: 'dev-only', apply: 'serve',
    configureServer(s) {
      s.middlewares.use(async (req, res, next) => {
        const url = req.url.split('?')[0]
        try {
          // الدخول (كما يصله من الصفحة عبر /api/functions/v1/reseller-login/…)
          if (url.startsWith('/api/functions/v1/reseller-login/')) {
            const buf = await body(req)
            const r = await call(req, url, buf)
            if (url.endsWith('/start')) { const j = await r.clone().json().catch(() => ({})); lastNonce = j.nonce ?? lastNonce }
            return send(res, r)
          }
          // supabase-js يتحقق من الجلسة عبر GET /auth/v1/user: في الإنتاج GoTrue، هنا نقرأ الرمز ونتحقق من توقيعه
          if (url === '/api/auth/v1/user') {
            const t = (req.headers.authorization ?? '').replace(/^Bearer /, ''), [h, p, sg] = t.split('.')
            const ok = sg && createHmac('sha256', secrets().secret).update(`${h}.${p}`).digest('base64url') === sg
            const c = ok ? JSON.parse(Buffer.from(p, 'base64url')) : null
            res.setHeader('Content-Type', 'application/json')
            if (!c || c.exp < Date.now() / 1000) { res.statusCode = 401; return res.end('{"msg":"invalid"}') }
            return res.end(JSON.stringify({ id: c.sub, aud: c.aud, role: c.role, email: c.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }))
          }
          // محاكي تيليغرام
          if (url === '/dev/telegram/last') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ nonce: lastNonce, outbox })) }
          if (url === '/dev/telegram/update' && req.method === 'POST') {
            outbox = []
            const r = await call({ method: 'POST' }, '/webhook', await body(req))
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: r.status, outbox })); return
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
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devOnly()],
  build: { rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), panel: fileURLToPath(new URL('./panel/index.html', import.meta.url)) } } },
  server: {
    port: 5180,
    allowedHosts: ['.localhost'],
    proxy: { '/api/rest/v1': { target: API, rewrite: (p) => p.replace(/^\/api\/rest\/v1/, '') } },
  },
})
