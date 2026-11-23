import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  ArrowRight, Trash2, Loader2, CheckCircle2, Truck, ImageOff, Plus, Minus, Copy, Check,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { priceOf, lineTotal, stepFor, minFor, maxFor, packOf, packName, qtyText } from '../../lib/price'
import { formatIQD, formatNumber } from '../../lib/format'
import { useCart } from '../../context/CartContext'
import { buildOrderMessage } from '../../lib/orderText'
import ContactCard from '../../components/ContactCard'
import { orderWindow } from '../../lib/store'

export default function Checkout() {
  const cart = useCart()
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [zones, setZones] = useState([])
  const [form, setForm] = useState({ name: '', phone: '', zoneId: '', note: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)   // ردّ create_order بعد النجاح
  const [copied, setCopied] = useState(false)

  const ids = Object.keys(cart.items)
  const isWholesale = cart.mode === 'wholesale'
  const backTo = isWholesale ? '/wholesale' : '/retail'

  useEffect(() => {
    if (ids.length === 0) { setLoading(false); return }
    Promise.all([
      supabase.from('storefront_products').select('*').in('id', ids),
      // فعّالة فقط: سياسة القراءة تُظهر المعطَّلة للمدير، فيرى ما يراه الزبون بالضبط
      supabase.from('delivery_zones').select('id, name, fee').eq('is_active', true).order('sort_order'),
    ]).then(([p, z]) => {
      setProducts(p.data ?? [])
      setZones(z.data ?? [])
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.length])

  if (!cart.mode) return <Navigate to="/" replace />

    const subtotal = products.reduce((s, p) => s + lineTotal(p, cart.mode, cart.items[p.id] ?? 0), 0)
  const zone = zones.find((z) => String(z.id) === form.zoneId)
  const total = subtotal + (zone?.fee ?? 0)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.zoneId) return setError('اختر منطقة التوصيل')
    setBusy(true)

    // المتصفح يرسل المعرّفات والكميات فقط — الأسعار والأجور تُحسب في قاعدة البيانات
    const { data, error } = await supabase.rpc('create_order', {
      p_customer_name: form.name.trim(),
      p_customer_phone: form.phone.trim(),
      p_items: ids.map((id) => ({ product_id: id, qty: cart.items[id] })),
      p_mode: cart.mode,
      p_zone_id: Number(form.zoneId),
      p_note: form.note.trim() || null,
    })

    if (error) {
      setError(error.message)
      setBusy(false)
      return
    }

    cart.clear()
    setResult({ ...data, deferred: orderWindow(), customer_name: form.name.trim(), customer_phone: form.phone.trim(), customer_note: form.note.trim() })
  }

  // ---------- شاشة النجاح ----------
  if (result) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-5 text-center">
        <CheckCircle2 className="animate-pop mx-auto size-16 text-brand-700" />
        <div className="animate-fade-up">
          <h1 className="text-xl font-bold">
            رقم طلبك <span className="text-brand-700 tnum">#{result.order_number}</span>
          </h1>
          <p className="mt-1.5 leading-relaxed text-ink-700">
            {result.deferred.open
              ? 'سيتم التواصل معك قريباً أو عند استلام الطلب.'
              : `وصلنا طلبك خارج أوقات العمل، وسيُجهَّز ${result.deferred.when} من الساعة 9:00 صباحاً.`}
          </p>
        </div>

        {/* المبلغ الذي يدفعه الزبون للمندوب — أهم رقم في الشاشة، فهو البطل */}
        <div className="animate-fade-up surface-ink p-5" style={{ animationDelay: '80ms' }}>
          <p className="text-sm font-bold text-white/80">المبلغ الكلي للتسليم</p>
          <p className="price-xl mt-1 text-white">
            {formatNumber(result.total_amount)} <span className="text-[20px]">دينار</span>
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-white/75">
            البضاعة {formatNumber(result.subtotal)} + التوصيل إلى {result.delivery_zone}{' '}
            {formatNumber(result.delivery_fee)}
          </p>
        </div>

        {result.has_price_request && (
          <p className="animate-fade-up rounded-2xl bg-amber-50 p-3 text-sm font-bold leading-relaxed text-warn-600">
            في طلبك بند بلا سعر — يُحدَّد عند التأكيد، فيتغيّر المبلغ أعلاه.
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(buildOrderMessage(result))
              .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500) })
              .catch(() => setCopied(false))
          }}
          className="animate-fade-up flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink-100 text-sm font-extrabold text-ink-900 active:scale-95"
          style={{ animationDelay: '200ms' }}
        >
          {copied ? <Check className="size-4 text-brand-700" /> : <Copy className="size-4" />}
          {copied ? 'نُسخ النص' : 'نسخ نص الطلب'}
        </button>

        <p aria-live="polite" className="text-xs leading-relaxed text-ink-600">
          {copied ? 'نُسخ نص الطلب — احتفظ به أو أرسله لمن تشاء.' : '\u00a0'}
        </p>

        <Link to="/" className="text-sm font-semibold text-ink-600">العودة للمتجر</Link>
        <ContactCard className="mt-2 text-start" />
      </main>
    )
  }

  // ---------- السلة فارغة ----------
  if (!loading && ids.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-5 text-center">
        <p className="text-ink-600">سلّتك فارغة.</p>
        <Link to={backTo} className="rounded-xl bg-brand-700 px-5 py-2.5 font-semibold text-white">تصفّح المنتجات</Link>
      </main>
    )
  }

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center"><Loader2 className="size-8 animate-spin text-brand-700" /></div>
  }

  const field = 'w-full rounded-2xl border border-ink-200 bg-white px-3.5 py-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none'
  const label = 'block text-sm font-semibold mb-1'

  return (
    <form onSubmit={submit} className="mx-auto max-w-md pb-28" id="checkout-form">
      <header className="glass sticky top-0 z-20 flex items-center gap-2 p-3">
        <button type="button" onClick={() => navigate(backTo)} className="rounded-lg p-1.5 hover:bg-ink-100" aria-label="رجوع">
          <ArrowRight className="size-5" />
        </button>
        <h1 className="font-bold">سلّة المشتريات</h1>
        <span className="ms-auto rounded-lg bg-ink-100 px-2.5 py-1 text-xs font-semibold">
          {isWholesale ? 'جملة' : 'مفرد'}
        </span>
      </header>

      <main className="grid gap-2 p-3">
        {products.map((p) => {
          const qty = cart.items[p.id] ?? 0
          const price = priceOf(p, cart.mode, qty)
          const step = stepFor(cart.mode, p)
          const min = minFor(cart.mode, p)
          const pack = packOf(p, cart.mode)
          const maxQty = maxFor(cart.mode, p)
          return (
            <div key={p.id} className="animate-fade-up card p-3">
              <div className="flex items-center gap-3">
                {p.image_url ? (
                  <img src={p.image_url} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-ink-100"><ImageOff className="size-5 text-ink-600" /></span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="text-xs text-ink-600">
                    {price === 0 ? 'السعر عند الطلب' : `${formatIQD(price)} ${pack ? `لل${packName(pack)}` : 'للقطعة'}`}
                  </p>
                  <p className="text-sm font-extrabold text-brand-700">
                    {price === 0 ? '—' : formatIQD(lineTotal(p, cart.mode, qty))}
                  </p>
                </div>
                <button type="button" onClick={() => cart.setQty(p.id, 0)} className="rounded-lg p-2 text-danger-700 hover:bg-red-50" aria-label="حذف">
                  <Trash2 className="size-4" />
                </button>
              </div>

              {/* تعديل الكمية من داخل السلة مباشرة */}
              <div className="mt-2.5 flex items-center gap-2">
                <div className="flex flex-1 items-center justify-between rounded-2xl bg-brand-50 p-1 ring-1 ring-brand-600/15">
                  <button type="button" onClick={() => cart.setQty(p.id, qty - step < min ? 0 : qty - step)}
                          className="flex size-9 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm transition active:scale-90"
                          aria-label="إنقاص">
                    <Minus className="size-4" />
                  </button>
                  <span className="text-[13px] font-extrabold text-brand-900">
                    {qtyText(qty, pack)}{pack > 0 && ` — ${formatNumber(qty)} قطعة`}
                  </span>
                  <button type="button" onClick={() => cart.setQty(p.id, Math.min(qty + step, maxQty))}
                          disabled={qty >= maxQty}
                          className="flex size-9 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm transition active:scale-90 disabled:opacity-40"
                          aria-label="زيادة">
                    <Plus className="size-4" />
                  </button>
                </div>
                <input
                  type="number" min={min / step} max={maxQty / step} inputMode="numeric"
                  value={qty / step}
                  onChange={(e) => {
                    const n = Math.max(0, Math.min(Number(e.target.value) || 0, maxQty / step))
                    cart.setQty(p.id, n > 0 ? Math.max(Math.floor(n) * step, min) : 0)
                  }}
                  className="w-20 rounded-2xl border border-ink-200 bg-white px-2 py-2.5 text-center text-sm font-bold focus:border-brand-500 focus:outline-none"
                  aria-label={pack ? `عدد ال${packName(pack)}` : 'عدد القطع'}
                />
              </div>
              {qty >= maxQty && (
                <p className="mt-1.5 text-[11px] text-warn-600">
                  هذه أقصى كمية متوفرة حالياً ({formatNumber(p.quantity_single)} قطعة).
                </p>
              )}
            </div>
          )
        })}
      </main>

      <div className="grid gap-3 p-3">
        <div>
          <label className={label} htmlFor="name">الاسم الكامل *</label>
          <input id="name" required minLength={2} value={form.name} autoComplete="name"
                 onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="phone">رقم الهاتف *</label>
          <input id="phone" required type="tel" inputMode="tel" dir="ltr" placeholder="07XXXXXXXXX"
                 autoComplete="tel" value={form.phone}
                 onChange={(e) => setForm({ ...form, phone: e.target.value })}
                 className={field + ' text-start tnum'} />
        </div>
        <div>
          <label className={label} htmlFor="zone">منطقة التوصيل *</label>
          <select id="zone" required value={form.zoneId}
                  onChange={(e) => setForm({ ...form, zoneId: e.target.value })} className={field}>
            <option value="">— اختر المنطقة —</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name} {z.fee > 0 ? `— ${formatIQD(z.fee)}` : '— مجاناً'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="note">أقرب نقطة دالة (اختياري)</label>
          <input id="note" value={form.note} autoComplete="address-line1"
                 onChange={(e) => setForm({ ...form, note: e.target.value })}
                 placeholder="مثال: قرب جامع الرحمن" className={field} />
        </div>
      </div>

      <div className="card mx-3 p-4 text-sm">
        <Row label="مجموع البضاعة" value={formatIQD(subtotal)} />
        <Row
          label={<span className="flex items-center gap-1"><Truck className="size-4" /> التوصيل</span>}
          value={zone ? (zone.fee > 0 ? formatIQD(zone.fee) : 'مجاناً') : '— اختر المنطقة'}
        />
        <div className="mt-2 border-t border-ink-200 pt-2">
          <Row label="المجموع الكلي" value={formatIQD(total)} bold />
        </div>
        <p className="mt-2 text-xs text-ink-600">
          المبالغ النهائية تُحسب في المتجر عند الحفظ، والمبلغ الظاهر هنا هو ما يصلك.
        </p>
      </div>

      {error && (
        <p role="alert" className="surface mx-3 mt-3 border-s-4 border-danger-700 p-3 text-sm font-semibold text-danger-700">
          {error}
        </p>
      )}

      {!orderWindow().open && (
        <p className="mx-3 mt-3 rounded-2xl bg-amber-50 p-3 text-sm font-bold leading-relaxed text-warn-600">
          {orderWindow().holiday ? 'اليوم الجمعة إجازة في المتجر.' : 'المتجر مغلق الآن.'}{' '}
          يمكنك إرسال طلبك وسيُجهَّز {orderWindow().when} من الساعة 9:00 صباحاً.
          {!orderWindow().holiday && ' (آخر طلب لليوم الساعة 5:45 مساءً)'}
        </p>
      )}

      <div className="glass fixed inset-x-0 bottom-0 mx-auto max-w-md p-3">
        <button type="submit" disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-700 py-3.5 font-bold text-white active:scale-95 disabled:opacity-60">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <CheckCircle2 className="size-5" />}
          تأكيد الطلب
        </button>
      </div>
    </form>
  )
}

function Row({ label, value, bold }) {
  return (
    <div className={`flex items-center justify-between py-1 ${bold ? 'text-base font-bold' : 'text-ink-600'}`}>
      <span>{label}</span>
      <span className={bold ? 'text-brand-700' : 'font-semibold text-ink-800'}>{value}</span>
    </div>
  )
}
