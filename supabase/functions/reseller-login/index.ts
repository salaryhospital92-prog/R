// دالة حافة: دخول المروّجين عبر تيليغرام. غير منشورة — النشر بعد موافقة المالك (راجع docs/reseller-design.md §13).
// الأسرار: RESELLER_BOT_TOKEN, RESELLER_BOT_USERNAME, RESELLER_WEBHOOK_SECRET (+ مفاتيح Supabase التلقائية).
// بوت المروّجين منفصل عن بوت الرفاعي عمداً: اسمه وصورته للمنصة لا للرفاعي.
// التعيين: supabase functions deploy reseller-login --no-verify-jwt   (الاستدعاء من الصفحة بلا JWT؛ الحماية في دوال القاعدة)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { makeHandler } from './handler.js'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const TOKEN = Deno.env.get('RESELLER_BOT_TOKEN') ?? ''

const tg = async (method: string, payload: unknown) => {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    return await r.json()
  } catch { return {} }
}

// جلسة عادية بلا كلمة سر: ننشئ المستخدم إن لم يوجد، ونولّد رمز دخول يستبدله المتصفح بجلسة (verifyOtp)
const session = async (email: string) => {
  await db.auth.admin.createUser({ email, email_confirm: true })       // خطأ «موجود مسبقاً» متوقع ويُتجاهل
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  return { userId: data.user.id, payload: { token_hash: data.properties.hashed_token, email } }
}

Deno.serve(makeHandler({
  db, tg, session,
  env: { BOT_USERNAME: Deno.env.get('RESELLER_BOT_USERNAME') ?? '', WEBHOOK_SECRET: Deno.env.get('RESELLER_WEBHOOK_SECRET') ?? '' },
}))
