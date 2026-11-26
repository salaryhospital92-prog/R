import { createClient } from '@supabase/supabase-js'
import { ANON, API } from './config'

// المتجر بلا جلسات: لا تخزين ولا تجديد. المفتاح علني بطبيعته.
const sb = createClient(API, ANON, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const call = async (fn, args) => {
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw error
  return data
}

/** المتجر الفعّال، أو null (غير موجود/موقوف/قيد المراجعة — الخادم لا يفرّق عمداً) */
export const getStore = (slug) => call('reseller_store', { p_slug: slug })
export const getProducts = (slug) => call('reseller_store_products', { p_slug: slug })
/** منتجات المتجر الخاصة (يوصلها بنفسه) وأجرة توصيلها */
export const getOwn = (slug) => call('reseller_store_own', { p_slug: slug })
/** الدفع: منتجات الرفاعي ومنتجات المتجر في معاملة واحدة، ولكل جزء مجموعه المتوقع */
export const checkout = (slug, f) =>
  call('reseller_checkout', {
    p_slug: slug, p_customer_name: f.name, p_customer_phone: f.phone, p_items: f.items, p_own_items: f.ownItems,
    p_zone_id: f.zone, p_note: f.note || null, p_expected_total: f.expected, p_expected_own_total: f.expectedOwn,
  })

export { errText } from './config'
