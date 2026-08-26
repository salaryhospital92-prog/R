import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  ArrowRight, Trash2, Loader2, CheckCircle2, MessageCircle, Truck, ImageOff,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatIQD, formatNumber } from '../../lib/format'
import { useCart } from '../../context/CartContext'
import { buildOrderMessage, whatsappUrl, storePhoneConfigured } from '../../lib/whatsapp'
import ContactCard from '../../components/ContactCard'

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
  const opened = useRef(false)

  const ids = Object.keys(cart.items)
  const isWholesale = cart.mode === 'wholesale'
  const backTo = isWholesale ? '/wholesale' : '/retail'

  useEffect(() => {
    if (ids.length === 0) { setLoading(false); return }
    Promise.all([
      supabase.from('storefront_products').select('*').in('id', ids),
      supabase.from('delivery_zones').select('id, name, fee').order('sort_order'),
    ]).then(([p, z]) => {
      setProducts(p.data ?? [])
      setZones(z.data ?? [])
      setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.length])

  // فتح واتساب تلقائياً بعد نجاح الحفظ — والزر أدناه بديل إن منع المتصفح الفتح
  useEffect(() => {
    if (!result || opened.current) return
    opened.current = true
    window.location.href = whatsappUrl(buildOrderMessage(result))
  }, [result])

  if (!cart.mode) return <Navigate to="/" replace />

  const priceOf = (p) => (isWholesale ? p.price_wholesale : p.price_retail)
  const subtotal = products.reduce((s, p) => s + (cart.items[p.id] ?? 0) * priceOf(p), 0)
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
    setResult({ ...data, customer_name: form.name.trim(), customer_phone: form.phone.trim(), customer_note: form.note.trim() })
  }

  // ---------- شاشة النجاح ----------
  if (result) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-5 text-center">
        <CheckCircle2 className="animate-pop mx-auto size-16 text-brand-600" />
        <div className="animate-fade-up">
          <h1 className="text-xl font-bold">تم استلام طلبك</h1>
          <p className="mt-1 text-slate-600">رقم الطلب</p>
          <p className="text-3xl font-bold text-brand-700">#{result.order_number}</p>
        </div>

        <div className="animate-fade-up card p-4 text-start text-sm" style={{ animationDelay: '80ms' }}>
          <Row label="مجموع البضاعة" value={formatIQD(result.subtotal)} />
          <Row label={`التوصيل — ${result.delivery_zone}`} value={formatIQD(result.delivery_fee)} />
          <div className="mt-2 border-t border-slate-200 pt-2">
            <Row label="المجموع الكلي" value={formatIQD(result.total_amount)} bold />
          </div>
        </div>

        <p className="animate-fade-up text-sm text-slate-600" style={{ animationDelay: '140ms' }}>
          أرسل الطلب عبر واتساب ليصل المتجر ويتواصلوا معك.
        </p>

        <a
          href={whatsappUrl(buildOrderMessage(result))}
          className="animate-fade-up flex items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 font-bold text-white active:scale-95"
          style={{ animationDelay: '200ms' }}
        >
          <MessageCircle className="size-5" /> إرسال الطلب عبر واتساب
        </a>

        <Link to="/" className="text-sm font-semibold text-slate-500">العودة للمتجر</Link>
        <ContactCard className="mt-2 text-start" />
      </main>
    )
  }

  // ---------- السلة فارغة ----------
  if (!loading && ids.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-5 text-center">
        <p className="text-slate-500">سلّتك فارغة.</p>
        <Link to={backTo} className="rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white">تصفّح المنتجات</Link>
      </main>
    )
  }

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center"><Loader2 className="size-8 animate-spin text-brand-600" /></div>
  }

  const field = 'w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none'
  const label = 'block text-sm font-semibold mb-1'

  return (
    <form onSubmit={submit} className="mx-auto max-w-md pb-28">
      <header className="glass sticky top-0 z-20 flex items-center gap-2 p-3">
        <button type="button" onClick={() => navigate(backTo)} className="rounded-lg p-1.5 hover:bg-slate-100" aria-label="رجوع">
          <ArrowRight className="size-5" />
        </button>
        <h1 className="font-bold">سلّة المشتريات</h1>
        <span className="ms-auto rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold">
          {isWholesale ? 'جملة' : 'مفرد'}
        </span>
      </header>

      <div className="grid gap-2 p-3">
        {products.map((p) => {
          const qty = cart.items[p.id] ?? 0
          const price = priceOf(p)
          return (
            <div key={p.id} className="animate-fade-up card flex items-center gap-3 p-3">
              {p.image_url ? (
                <img src={p.image_url} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
              ) : (
                <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-slate-100"><ImageOff className="size-5 text-slate-400" /></span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{p.name}</p>
                <p className="text-xs text-slate-500">
                  {isWholesale ? `${formatNumber(qty / 12)} درزن (${formatNumber(qty)} قطعة)` : `${formatNumber(qty)} قطعة`}
                </p>
                <p className="text-sm font-bold text-brand-700">
                  {price === 0 ? 'السعر عند الطلب' : formatIQD(price * qty)}
                </p>
              </div>
              <button type="button" onClick={() => cart.setQty(p.id, 0)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" aria-label="حذف">
                <Trash2 className="size-4" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="grid gap-3 p-3">
        <div>
          <label className={label} htmlFor="name">الاسم الكامل *</label>
          <input id="name" required minLength={2} value={form.name}
                 onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="phone">رقم الهاتف *</label>
          <input id="phone" required type="tel" inputMode="tel" dir="ltr" placeholder="07XXXXXXXXX"
                 value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                 className={field + ' text-start'} />
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
          <input id="note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                 placeholder="مثال: قرب جامع الرحمن" className={field} />
        </div>
      </div>

      <div className="card mx-3 p-4 text-sm">
        <Row label="مجموع البضاعة" value={formatIQD(subtotal)} />
        <Row
          label={<span className="flex items-center gap-1"><Truck className="size-4" /> التوصيل</span>}
          value={zone ? (zone.fee > 0 ? formatIQD(zone.fee) : 'مجاناً') : '— اختر المنطقة'}
        />
        <div className="mt-2 border-t border-slate-200 pt-2">
          <Row label="المجموع الكلي" value={formatIQD(total)} bold />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          المبالغ النهائية تُحسب في المتجر عند الحفظ، وتظهر في رسالة الواتساب.
        </p>
      </div>

      {!storePhoneConfigured && (
        <p className="mx-3 mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          رقم واتساب المتجر غير مضبوط — أضف VITE_STORE_WHATSAPP في ملف .env.
        </p>
      )}
      {error && <p className="mx-3 mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="glass fixed inset-x-0 bottom-0 mx-auto max-w-md p-3">
        <button type="submit" disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 font-bold text-white active:scale-95 disabled:opacity-60">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <MessageCircle className="size-5" />}
          إرسال الطلب عبر واتساب
        </button>
      </div>
    </form>
  )
}

function Row({ label, value, bold }) {
  return (
    <div className={`flex items-center justify-between py-1 ${bold ? 'text-base font-bold' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className={bold ? 'text-brand-700' : 'font-semibold text-slate-800'}>{value}</span>
    </div>
  )
}
