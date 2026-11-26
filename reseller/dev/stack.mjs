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

const API = 'reseller-dev-api', AUTH = 'reseller-dev-auth', NET = 'reseller-dev-net', PORT = 3101, AUTH_PORT = 3102
const docker = (...a) => spawnSync('docker', a, { encoding: 'utf8' })
const DRAFTS = ['015_close_public_signup', '016_rifai_line', '017_reseller_schema', '018_reseller_orders', '019_reseller_money', '020_reseller_reports', '021_reseller_login', '022_reseller_secrets', '023_reseller_db_login', '024_razq_products_and_phone']
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

const down = () => { docker('rm', '-f', API); docker('rm', '-f', AUTH); docker('rm', '-f', 'reseller-dev-db'); docker('network', 'rm', NET) }

const cmd = process.argv[2]
if (cmd === 'down') { down(); console.log('أُزيلت الحاويات والشبكة') }
else if (cmd === 'sql') { console.log(must('sql', psql(process.argv[3]))) }
else if (cmd === 'up') {
  down()
  must('network', docker('network', 'create', '--internal', NET))
  const secret = randomBytes(32).toString('hex')
  // GoTrue حقيقي (نفس إصدار الحيّ تقريباً): يُنشئ مخطط auth قبل تهيئتنا، ويخدم الدخول وكلمة السر
  start({ before: () => {
    must('auth role', psql("alter role supabase_auth_admin with password 'local'", { user: 'supabase_admin' }))
    must('create auth', docker('create', '--name', AUTH, '-p', `127.0.0.1:${AUTH_PORT}:9999`,
      '-e', 'GOTRUE_DB_DRIVER=postgres', '-e', 'GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:local@reseller-dev-db:5432/postgres',
      '-e', `GOTRUE_JWT_SECRET=${secret}`, '-e', 'API_EXTERNAL_URL=http://localhost:5180/api/auth/v1', '-e', 'GOTRUE_SITE_URL=http://localhost:5180',
      '-e', 'GOTRUE_API_HOST=0.0.0.0', '-e', 'PORT=9999', '-e', 'GOTRUE_JWT_AUD=authenticated', '-e', 'GOTRUE_DISABLE_SIGNUP=true',
      '-e', 'GOTRUE_EXTERNAL_EMAIL_ENABLED=true', 'public.ecr.aws/supabase/gotrue:v2.198.0'))
    must('connect auth', docker('network', 'connect', NET, AUTH))
    must('start auth', docker('start', AUTH))
    for (let i = 0; !/API started/.test(docker('logs', AUTH).stderr + docker('logs', AUTH).stdout); i++) {
      if (i > 90) throw new Error('GoTrue لم يبدأ:\n' + docker('logs', AUTH).stderr.slice(-800))
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
    }
  } })
  for (const d of DRAFTS) must(d, psql(migration(d), { tx: true }))
  must('seed', psql(seedSql(), { tx: true }))
  writeAssets()
  // PostgREST يدخل بدور authenticator ثم يبدّل إلى anon/authenticated حسب JWT
  must('role', psql("alter role authenticator with password 'local'", { user: 'supabase_admin' }))
  const sign = (p) => { const h = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(p)}`; return `${h}.${createHmac('sha256', secret).update(h).digest('base64url')}` }
  const anon = sign({ role: 'anon', iss: 'reseller-dev', exp: 4102444800 })
  must('create api', docker('create', '--name', API, '-p', `127.0.0.1:${PORT}:3000`,
    '-e', 'PGRST_DB_URI=postgres://authenticator:local@reseller-dev-db:5432/postgres', '-e', 'PGRST_DB_SCHEMAS=public',
    '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${secret}`, 'public.ecr.aws/supabase/postgrest:v16.5'))
  must('connect api', docker('network', 'connect', NET, API))
  must('start api', docker('start', API))
  writeFileSync(fileURLToPath(new URL('../.env.development.local', import.meta.url)), `VITE_ANON_KEY=${anon}\n`)
  // لمحاكي تيليغرام في vite.config.js (ملف محلي غير متتبَّع)
  must('bot secrets', psql("insert into public.reseller_secrets (key, value) values ('bot_username', 'dev_bot'), ('webhook_secret', 'dev-hook-secret'), ('bot_token', '0:dev')"))
  writeFileSync(fileURLToPath(new URL('./.secrets.json', import.meta.url)), JSON.stringify({ anon, hook: 'dev-hook-secret' }))
  console.log(`جاهز: http://127.0.0.1:${PORT} (PostgREST) — ثم: npm --prefix reseller run dev ← المتجر /s/noor-store ، اللوحة /panel/`)
} else console.log('الاستعمال: up | down | sql "…"')
