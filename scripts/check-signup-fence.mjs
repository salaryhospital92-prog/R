// فحص ترحيل 013 على Postgres محلي معزول:  node scripts/check-signup-fence.mjs
// حاوية docker مؤقتة بلا شبكة (--network none) وكل الأوامر عبر docker exec — لا يقرأ
// .db.local ولا يستطيع الوصول إلى القاعدة الحيّة أو تيليغرام أو زاد. تُحذف في النهاية.
// يعيد بناء القاعدة من ملفات المستودع (schema + operations + ما قبل 013) ثم:
//   1) يشغّل الفحص قبل 013 ويتوقع فشله (إثبات أن الفحص يكشف الثغرة)
//   2) يطبّق 013 داخل معاملة ثم يشغّل الفحص ويتوقع نجاحه
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const IMAGE = process.env.PG_IMAGE ?? 'public.ecr.aws/supabase/postgres:17.12.0.000'
const root = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const name = `rafai-fence-${process.pid}`
const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8' })
const psql = (sql, { user = 'postgres', tx = false, db = 'postgres' } = {}) =>
  docker(['exec', '-i', '-e', 'PGPASSWORD=local', '-e', 'PGCLIENTENCODING=UTF8', name, 'psql', '-h', '127.0.0.1',
    '-U', user, '-d', db, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...(tx ? ['-1'] : []), '-f', '-'], sql)
const must = (label, r) => {
  if (r.status !== 0) throw new Error(`${label}\n${(r.stderr || r.stdout || String(r.error)).split('\n').filter((l) => /ERROR|فشل|error|DETAIL|CONTEXT/.test(l)).slice(0, 6).join('\n')}`)
}

// ما تملكه خدمات Supabase (Auth/Storage) ولا تأتي به صورة Postgres وحدها — مطابق للحيّ
const BOOT = `
alter table auth.users add column if not exists email_confirmed_at timestamptz,
  add column if not exists is_anonymous boolean not null default false;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
grant insert, update, select, trigger on auth.users to postgres;
create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
alter table storage.buckets owner to postgres; alter table storage.objects owner to postgres;

alter publication supabase_realtime owner to postgres;`

// حسابات موجودة قبل الترحيل — يجب ألا تتغيّر
const SEED = ['admin', 'data_entry', 'mona_admin'].map((r) => `
with u as (insert into auth.users (id, aud, role, email, email_confirmed_at, created_at)
  values (gen_random_uuid(), 'authenticated', 'authenticated', 'old-${r}@example.test', now(), now() - interval '9 days') returning id)
select id from u;
update public.profiles set role = '${r}' where id = (select id from auth.users where email = 'old-${r}@example.test');`).join('')

let code = 0
try {
  must('docker run', docker(['run', '-d', '--name', name, '--network', 'none', '-e', 'POSTGRES_PASSWORD=local', IMAGE]))
  // التهيئة تعيد التشغيل مرة: ننتظر نجاحين متتاليين عبر TCP
  for (let ok = 0, i = 0; ok < 2; i++) {
    if (i > 90) throw new Error('القاعدة المحلية لم تجهز')
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
    ok = psql('select 1').status === 0 ? ok + 1 : 0
  }
  must('bootstrap', psql(BOOT, { user: 'supabase_admin' }))
  must('schema.sql', psql(read('supabase/schema.sql')))
  // operations.sql (زاد) يستدعي is_mona_admin التي لا تُنشأ إلا في 010 — بديل مؤقت تستبدله 010
  must('stub', psql('create or replace function public.is_mona_admin() returns boolean language sql as $$ select false $$;'))
  must('operations.sql', psql(read('supabase/operations.sql')))
  for (const f of readdirSync(new URL('supabase/migrations/', root)).filter((f) => f.endsWith('.sql') && f < '013').sort()) {
    const sql = read(`supabase/migrations/${f}`)
    must(f, psql(sql, { tx: !/^\s*--\s*no-transaction/i.test(sql) }))
  }
  must('seed', psql(SEED))
  console.log('✔ بُنيت القاعدة المحلية من ملفات المستودع حتى ما قبل 013')

  const test = read('supabase/signup-fence-test.sql')
  const before = psql(test)
  if (before.status === 0 || !/فشل: 1أ/.test(before.stderr)) throw new Error('الفحص لم يكشف الثغرة قبل 013:\n' + before.stderr.slice(-800))
  console.log('✔ قبل 013: الفحص يفشل عند «1أ» كما يجب (الثغرة مُثبتة محلياً)')

  const draft = 'supabase/migrations/013_close_public_signup.sql'
  const mig = read(existsSync(new URL(draft, root)) ? draft : draft + '.draft')
  must('013', psql(mig, { tx: true }))
  must('013 (إعادة تشغيل)', psql(mig, { tx: true }))
  console.log('✔ طُبِّق 013 داخل معاملة بدور postgres (غير superuser) وأُعيد تشغيله بلا خطأ')

  const after = psql(test)
  console.log((after.stderr.match(/✔ .*/g) ?? []).join('\n'))
  must('الفحص بعد 013', after)
  if (!/ALL-OK/.test(after.stdout)) throw new Error('لم يكتمل الفحص')
  console.log('✅ كل الفحوصات نجحت')
} catch (e) {
  console.error('✘ ' + e.message)
  code = 1
} finally {
  docker(['rm', '-f', name])
}
process.exit(code)
