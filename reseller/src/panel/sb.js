import { createClient } from '@supabase/supabase-js'
import { ANON, API, ROOT } from '../lib/config'

// لوحة المروّج: جلسة محفوظة (على نطاق اللوحة وحده، لا تشاركها المتاجر). المفتاح علني بطبيعته.
export const sb = createClient(API, ANON, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'panel-auth' } })

/** rpc يرمي عند الخطأ ويعيد البيانات */
export const rpc = async (fn, args) => {
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw error
  return data
}
/** استعلام جدول يرمي عند الخطأ */
export const q = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data
}

const FN = `${API}/functions/v1/reseller-login`
export const login = async (path, body) => {
  const r = await fetch(`${FN}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || 'تعذّر الاتصال'), { code: 'P0001' })
  return j
}

/** رابط المتجر للمشاركة: متجر.النطاق، أو مسار التطوير */
export const storeUrl = (slug) => (ROOT ? `https://${slug}.${ROOT}` : `${location.origin}/s/${slug}`)

/** نسبة → سعر كما تحسبه reseller_price: زيادة ثم تقريب لأعلى (لا أقل من الأساس) */
export const priceFor = (base, pct, round = 250) => Math.max(base, Math.ceil((base * (100 + pct)) / 100 / round) * round)

/** تنقّل اللوحة بالهاش */
export const nav = (h) => { location.hash = h; scrollTo(0, 0) }
