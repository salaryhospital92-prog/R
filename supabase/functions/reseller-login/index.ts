// دالة حافة: دخول المروّجين عبر تيليغرام (راجع docs/reseller-design.md §13–16).
// الأسرار (الرمز، المعرّف، سرّ الويبهوك) في جدول reseller_secrets تقرؤه دالة service_role (ترحيل 022): لا أسرار دوال.
// بوت المروّجين منفصل عن بوت الرفاعي عمداً. النشر: --no-verify-jwt (الاستدعاء من الصفحة وتيليغرام بلا JWT؛ الحماية في دوال القاعدة).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { makeHandler } from './handler.js'

const URL = Deno.env.get('SUPABASE_URL')!
const db = createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

// تُقرأ عند البدء البارد: تغيير سرّ يتطلب إعادة نشر الدالة
const secret = async (k: string) => {
  const { data, error } = await db.rpc('reseller_secret', { p_key: k })
  if (error) throw error
  return (data as string | null) ?? ''
}
const TOKEN = await secret('bot_token')
const env = { BOT_USERNAME: await secret('bot_username'), WEBHOOK_SECRET: await secret('webhook_secret'), WEBHOOK_URL: `${URL}/functions/v1/reseller-login/webhook` }

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

Deno.serve(makeHandler({ db, tg, session, env }))
