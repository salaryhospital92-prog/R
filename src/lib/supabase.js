import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  throw new Error('مفاتيح Supabase مفقودة — انسخ .env.example إلى .env واملأ القيم.')
}

// عميل واحد لكل التطبيق، بمفتاح anon فقط. الحماية مصدرها RLS في قاعدة البيانات.
export const supabase = createClient(url, key)
