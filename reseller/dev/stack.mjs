// قاعدة تجربة يدوية لمتجر المروّجين: Postgres محلي (من ملفات المستودع + المسودات 015–020 + بيانات وهمية)
// خلف PostgREST الحقيقي، فيتصرّف المتصفح كما سيتصرّف مع Supabase. لا يمسّ الحيّ ولا تيليغرام ولا زاد.
//   node reseller/dev/stack.mjs up      يبني (نحو دقيقة) ويطبع المنفذ
//   node reseller/dev/stack.mjs sql "…"  يشغّل SQL على القاعدة المحلية
//   node reseller/dev/stack.mjs down    يحذف الحاويات والشبكة
// العزل: قاعدة Postgres على شبكة docker داخلية (internal) فلا إنترنت لها ولا منفذ منشور؛
// PostgREST وحده على 127.0.0.1:3101، ومفتاح JWT مولَّد محلياً.
import { spawnSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

process.env.RAFAI_DB_NAME = 'reseller-dev-db'
process.env.RAFAI_DB_NETWORK = 'reseller-dev-net'
const { start, psql, must, migration } = await import('../../scripts/local-db.mjs')
const { seedSql, writeAssets } = await import('./seed.mjs')

const API = 'reseller-dev-api', NET = 'reseller-dev-net', PORT = 3101
const docker = (...a) => spawnSync('docker', a, { encoding: 'utf8' })
const DRAFTS = ['015_close_public_signup', '016_rifai_line', '017_reseller_schema', '018_reseller_orders', '019_reseller_money', '020_reseller_reports', '021_reseller_login', '022_reseller_secrets']
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

const down = () => { docker('rm', '-f', API); docker('rm', '-f', 'reseller-dev-db'); docker('network', 'rm', NET) }

const cmd = process.argv[2]
if (cmd === 'down') { down(); console.log('أُزيلت الحاويات والشبكة') }
else if (cmd === 'sql') { console.log(must('sql', psql(process.argv[3]))) }
else if (cmd === 'up') {
  down()
  must('network', docker('network', 'create', '--internal', NET))
  start()
  for (const d of DRAFTS) must(d, psql(migration(d), { tx: true }))
  must('seed', psql(seedSql(), { tx: true }))
  writeAssets()
  // PostgREST يدخل بدور authenticator ثم يبدّل إلى anon/authenticated حسب JWT
  must('role', psql("alter role authenticator with password 'local'", { user: 'supabase_admin' }))
  const secret = randomBytes(32).toString('hex')
  const sign = (p) => { const h = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(p)}`; return `${h}.${createHmac('sha256', secret).update(h).digest('base64url')}` }
  const anon = sign({ role: 'anon', iss: 'reseller-dev', exp: 4102444800 })
  must('create api', docker('create', '--name', API, '-p', `127.0.0.1:${PORT}:3000`,
    '-e', 'PGRST_DB_URI=postgres://authenticator:local@reseller-dev-db:5432/postgres', '-e', 'PGRST_DB_SCHEMAS=public',
    '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${secret}`, 'public.ecr.aws/supabase/postgrest:v16.5'))
  must('connect api', docker('network', 'connect', NET, API))
  must('start api', docker('start', API))
  writeFileSync(fileURLToPath(new URL('../.env.development.local', import.meta.url)), `VITE_ANON_KEY=${anon}\n`)
  // مفتاح الخدمة التجريبي وسرّ JWT لمحاكي الدخول في vite.config.js (ملف محلي غير متتبَّع)
  writeFileSync(fileURLToPath(new URL('./.secrets.json', import.meta.url)), JSON.stringify({ secret, service: sign({ role: 'service_role', iss: 'reseller-dev', exp: 4102444800 }) }))
  console.log(`جاهز: http://127.0.0.1:${PORT} (PostgREST) — ثم: npm --prefix reseller run dev ← المتجر /s/noor-store ، اللوحة /panel/`)
} else console.log('الاستعمال: up | down | sql "…"')
