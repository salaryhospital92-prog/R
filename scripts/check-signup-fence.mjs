// فحص ترحيل 015 على قاعدة محلية معزولة (انظر local-db.mjs):  node scripts/check-signup-fence.mjs
//   1) يشغّل الفحص قبل 015 ويتوقع فشله (إثبات أن الفحص يكشف الثغرة)
//   2) يطبّق 015 داخل معاملة ثم يشغّل الفحص ويتوقع نجاحه
import { start, stop, psql, must, read, migration } from './local-db.mjs'

// حسابات موجودة قبل الترحيل — يجب ألا تتغيّر
const SEED = ['admin', 'data_entry', 'mona_admin'].map((r) => `
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at)
  values (gen_random_uuid(), 'authenticated', 'authenticated', 'old-${r}@example.test', now(), now() - interval '9 days');
update public.profiles set role = '${r}' where id = (select id from auth.users where email = 'old-${r}@example.test');`).join('')

let code = 0
try {
  start()
  must('seed', psql(SEED))
  console.log('✔ بُنيت القاعدة المحلية من ملفات المستودع حتى ما قبل 015')

  const test = read('supabase/signup-fence-test.sql')
  const before = psql(test)
  if (before.status === 0 || !/فشل: 1أ/.test(before.stderr)) throw new Error('الفحص لم يكشف الثغرة قبل 015:\n' + before.stderr.slice(-800))
  console.log('✔ قبل 015: الفحص يفشل عند «1أ» كما يجب (الثغرة مُثبتة محلياً)')

  const mig = migration('015_close_public_signup')
  must('015', psql(mig, { tx: true }))
  must('015 (إعادة تشغيل)', psql(mig, { tx: true }))
  console.log('✔ طُبِّق 015 داخل معاملة بدور postgres (غير superuser) وأُعيد تشغيله بلا خطأ')

  const after = psql(test)
  console.log((after.stderr.match(/✔ .*/g) ?? []).join('\n'))
  must('الفحص بعد 015', after)
  if (!/ALL-OK/.test(after.stdout)) throw new Error('لم يكتمل الفحص')
  console.log('✅ كل الفحوصات نجحت')
} catch (e) {
  console.error('✘ ' + e.message)
  code = 1
} finally {
  stop()
}
process.exit(code)
