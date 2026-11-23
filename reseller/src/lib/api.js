import { createClient } from '@supabase/supabase-js'

// المتصفح لا يعرف مشروع القاعدة: كل شيء عبر /api على نطاق المتجر (وكيل). والمفتاح علني بطبيعته.
const API = import.meta.env.VITE_API_URL || `${location.origin}/api`
const sb = createClient(API, import.meta.env.VITE_ANON_KEY || 'anon', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

/** شعار المتجر: حاوية عامة، والمسار تتحقق منه الدالة (مجلد/اسم آمن) */
export const logoUrl = (path) => path && `${API}/storage/v1/object/public/reseller-logos/${path.split('/').map(encodeURIComponent).join('/')}`

const call = async (fn, args) => {
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw error
  return data
}

/** المتجر الفعّال، أو null (غير موجود/موقوف/قيد المراجعة — الخادم لا يفرّق عمداً) */
export const getStore = (slug) => call('reseller_store', { p_slug: slug })
export const getProducts = (slug) => call('reseller_store_products', { p_slug: slug })
export const createOrder = (slug, f) =>
  call('reseller_create_order', {
    p_slug: slug, p_customer_name: f.name, p_customer_phone: f.phone, p_items: f.items,
    p_zone_id: f.zone, p_note: f.note || null, p_expected_total: f.expected,
  })

/** رسائل الخادم (raise exception) عربية وآمنة فتُعرض كما هي؛ غيرها (شبكة/تقني) رسالة عامة */
export const errText = (e) => (e?.code === 'P0001' && /[؀-ۿ]/.test(e.message || '') ? e.message : 'تعذّر الاتصال — تحقق من الإنترنت وحاول مرة أخرى')
