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
export const createOrder = (slug, f) =>
  call('reseller_create_order', {
    p_slug: slug, p_customer_name: f.name, p_customer_phone: f.phone, p_items: f.items,
    p_zone_id: f.zone, p_note: f.note || null, p_expected_total: f.expected,
  })

export { errText } from './config'
