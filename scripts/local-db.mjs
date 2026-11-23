// قاعدة محلية مؤقتة للفحوص: حاوية docker بلا شبكة (--network none) وكل الأوامر عبر
// docker exec — لا تقرأ .db.local ولا تصل إلى القاعدة الحيّة أو تيليغرام أو زاد.
// تعيد بناء القاعدة من ملفات المستودع: schema + operations + الترحيلات المطبَّقة (.sql).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const IMAGE = process.env.PG_IMAGE ?? 'public.ecr.aws/supabase/postgres:17.12.0.000'
const root = new URL('../', import.meta.url)
export const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n')
/** مسودة أو ملف مُعتمد بنفس الاسم */
export const migration = (n) => read(`supabase/migrations/${n}.sql` + (existsSync(new URL(`supabase/migrations/${n}.sql`, root)) ? '' : '.draft'))

// الفحوص: اسم بالعملية وبلا شبكة. reseller/dev/stack.mjs يمرّر اسماً وشبكة داخلية (internal) لقاعدة التجربة اليدوية.
const name = process.env.RAFAI_DB_NAME ?? `rafai-check-${process.pid}`
const docker = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 64e6 })
const psqlArgs = ({ user = 'postgres', tx = false } = {}) => ['exec', '-i', '-e', 'PGPASSWORD=local', '-e', 'PGCLIENTENCODING=UTF8', name,
  'psql', '-h', '127.0.0.1', '-U', user, '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', ...(tx ? ['-1'] : []), '-f', '-']
export const psql = (sql, opt) => docker(psqlArgs(opt), sql)
/** جلسة متزامنة: وعدٌ بـ {status, stdout, stderr} */
export const session = (sql, opt) => new Promise((ok) => {
  const p = spawn('docker', psqlArgs(opt)); let stdout = '', stderr = ''
  p.stdout.setEncoding('utf8').on('data', (d) => { stdout += d }); p.stderr.setEncoding('utf8').on('data', (d) => { stderr += d })
  p.on('close', (status) => ok({ status, stdout, stderr }))
  p.stdin.end(sql)
})
export const errOf = (r) => (r.stderr || r.stdout || String(r.error)).split('\n').filter((l) => /ERROR|فشل|DETAIL|CONTEXT/.test(l)).slice(0, 6).join('\n')
export const must = (label, r) => { if (r.status !== 0) throw new Error(`${label}\n${errOf(r) || r.stderr}`); return r.stdout.trim() }

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
grant insert, update, select, references, trigger on auth.users to postgres;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to postgres, anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
alter table storage.objects enable row level security;
alter table storage.buckets owner to postgres; alter table storage.objects owner to postgres;
alter publication supabase_realtime owner to postgres;`

// 014 يشترط وجود أربعة منتجات بأسمائها
const SEED_014 = `
insert into public.products (name, category_id, sold_by) select n, (select min(id) from public.categories), 'dozen'
  from unnest(array['بطارية فيستل قلم وريمونت','صمغ اضافر 401','سيت بكرات خياطه الوان أبيض أو أسود','عطر Exotic_for man']) n;
update public.product_prices set price_dozen = 102000, price_retail = 10000
 where product_id = (select id from public.products where name = 'عطر Exotic_for man');`

export function start() {
  must('docker run', docker(['run', '-d', '--name', name, '--network', process.env.RAFAI_DB_NETWORK ?? 'none', '-e', 'POSTGRES_PASSWORD=local', IMAGE]))
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
  for (const f of readdirSync(new URL('supabase/migrations/', root)).filter((f) => f.endsWith('.sql') && f < '015').sort()) {
    if (f.startsWith('014')) must('seed 014', psql(SEED_014))
    const sql = read(`supabase/migrations/${f}`)
    must(f, psql(sql, { tx: !/^\s*--\s*no-transaction/i.test(sql) }))
  }
}
export const stop = () => docker(['rm', '-f', name])
