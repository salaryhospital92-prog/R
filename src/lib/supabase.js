import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('مفاتيح Supabase مفقودة — انسخ .env.example إلى .env واملأ القيم.')
}

// عميل واحد لكل التطبيق، بمفتاح anon فقط. الحماية مصدرها RLS في قاعدة البيانات.
export const supabase = createClient(url, key)

/**
 * هل توجد جلسة محفوظة في المتصفح؟ يُقرأ فوراً بلا انتظار الشبكة.
 * يُستعمل لعرض شاشة الدخول مباشرة بدل مؤشر تحميل دوّار لمن ليس مسجّلاً.
 */
export const hasStoredSession = () => {
  try {
    const ref = new URL(url).hostname.split('.')[0]
    return Boolean(localStorage.getItem(`sb-${ref}-auth-token`))
  } catch {
    return false
  }
}
