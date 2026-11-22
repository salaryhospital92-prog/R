// تطبيق ترحيلات قاعدة البيانات الجديدة تلقائياً — بلا اختيار حساب ولا لصق أوامر.
//   npm run db            يطبّق ما لم يُطبَّق بعد من supabase/migrations/*.sql بالترتيب
//   npm run db -- --list  يعرض الحالة فقط
// كل ملف يُطبَّق مرة واحدة داخل معاملة (يتراجع كله إن فشل) ويُسجَّل في schema_migrations.
// ملف يبدأ بالسطر «-- no-transaction» يُطبَّق بلا معاملة (لـ alter type … add value).
// كلمة سرّ القاعدة من .db.local (غير مرفوع إلى Git) أو من متغير البيئة PGPASS.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import pg from 'pg'

const root = new URL('../', import.meta.url)
const local = new URL('.db.local', root)
if (existsSync(local)) {
  for (const line of readFileSync(local, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}

const ref = process.env.PGREF ?? JSON.parse(readFileSync(new URL('supabase/.temp/linked-project.json', root), 'utf8')).ref
const client = new pg.Client({
  host: process.env.PGHOST ?? 'aws-0-eu-central-1.pooler.supabase.com',
  port: 5432,
  user: `postgres.${ref}`,
  password: process.env.PGPASS,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})
if (!process.env.PGPASS) { console.error('✘ لا توجد كلمة سرّ للقاعدة: ضعها في .db.local كسطر PGPASS=…'); process.exit(1) }

const dir = new URL('supabase/migrations/', root)
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : []

await client.connect()
try {
  await client.query(`create table if not exists public.schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`)
  const done = new Set((await client.query('select name from public.schema_migrations')).rows.map((r) => r.name))
  const pending = files.filter((f) => !done.has(f))

  if (process.argv.includes('--list')) {
    for (const f of files) console.log(done.has(f) ? '✔' : '•', f)
  } else if (!pending.length) {
    console.log('✔ القاعدة محدَّثة — لا ترحيلات جديدة.')
  } else {
    for (const f of pending) {
      const sql = readFileSync(new URL(f, dir), 'utf8')
      const tx = !/^\s*--\s*no-transaction/i.test(sql)
      try {
        if (tx) await client.query('begin')
        await client.query(sql)
        await client.query('insert into public.schema_migrations (name) values ($1)', [f])
        if (tx) await client.query('commit')
        console.log('✔ طُبِّق', f)
      } catch (e) {
        if (tx) await client.query('rollback').catch(() => {})
        console.error(`✘ فشل ${f}: ${e.message}`)
        process.exitCode = 1
        break
      }
    }
  }
} finally {
  await client.end().catch(() => {})
}
