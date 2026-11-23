import { useRef, useState } from 'react'
import { Banknote } from 'lucide-react'
import { createOrder, errText } from '../lib/api'
import { iqd, phoneOf } from '../lib/format'
import { lineTotal, pieces, unitsText } from '../lib/qty'
import { go } from '../lib/route'
import { useShop } from '../lib/shop'
import { Button, Notice, Page, Redirect } from '../ui'

const field = 'min-h-12 w-full rounded-2xl bg-stone-100 px-4 outline-none placeholder:text-stone-400 focus:bg-white focus:ring-2 focus:ring-brand aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-500'

function Field({ id, label, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[15px] font-bold">{label}</label>
      {children}
      {hint && !error && <p className="mt-1.5 text-sm text-stone-500">{hint}</p>}
      {error && <p id={`${id}-err`} className="mt-1.5 text-sm font-medium text-red-600">{error}</p>}
    </div>
  )
}

export default function Checkout() {
  const { slug, store, items, subtotal, refresh, cart, notes, dismissNotes } = useShop()
  const [f, setF] = useState({ name: '', phone: '', zone: 0, note: '' })
  const [errs, setErrs] = useState({})
  const [fail, setFail] = useState(null)        // {text, diff}
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const zone = store.zones.find((z) => z.id === f.zone)
  const total = subtotal + (zone?.fee ?? 0)
  const set = (patch) => { setF({ ...f, ...patch }); setErrs({ ...errs, ...Object.fromEntries(Object.keys(patch).map((k) => [k, null])) }) }

  if (!items.length) return <Redirect to="/cart" />

  const submit = async (e) => {
    e.preventDefault()
    if (lock.current) return
    const phone = phoneOf(f.phone)
    const next = {
      name: f.name.trim().length < 2 ? 'الرجاء إدخال اسمك' : null,
      phone: phone ? null : 'أدخل رقم موبايل عراقي صحيح، مثل 07701234567',
      zone: zone ? null : 'اختر منطقة التوصيل',
    }
    setErrs(next)
    const bad = Object.keys(next).find((k) => next[k])
    if (bad) { document.getElementById(`f-${bad}`)?.focus(); return }

    lock.current = true; setBusy(true); setFail(null)
    try {
      const r = await createOrder(slug, {
        name: f.name.trim(), phone, zone: zone.id, note: f.note.trim(), expected: total,
        items: items.map(({ p, units }) => ({ product_id: p.id, qty: pieces(p, units) })),   // القطع لا الوحدات
      })
      try { sessionStorage.setItem(`receipt:${slug}`, JSON.stringify(r)) } catch { /* يبقى في الذاكرة فقط */ }
      cart.clear(); dismissNotes()
      go('/done', { replace: true })
    } catch (err) {
      const text = errText(err)
      // أي رفض من الخادم قد يعني أن الأسعار أو المخزون أو المناطق تغيّرت: نزامن ثم نريه الفرق
      const fresh = err?.code === 'P0001' ? await refresh() : null
      let diff = null
      if (fresh) {
        const nz = fresh.store.zones.find((z) => z.id === f.zone)
        const nt = fresh.lines.reduce((t, l) => t + lineTotal(fresh.products.find((p) => p.id === l.id), l.units), 0) + (nz?.fee ?? 0)
        if (nt !== total) diff = `الإجمالي كان ${iqd(total)} وأصبح ${iqd(nt)}`
        if (!nz && f.zone) setF((x) => ({ ...x, zone: 0 }))
      }
      setFail({ text, diff })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      lock.current = false; setBusy(false)
    }
  }

  return (
    <Page title="إتمام الطلب" fallback="/cart"
      footer={<>
        <div className="mb-3 space-y-1 text-[15px]">
          <div className="flex justify-between text-stone-600"><span>المنتجات</span><span className="tabular-nums">{iqd(subtotal)}</span></div>
          <div className="flex justify-between text-stone-600"><span>التوصيل</span><span className="tabular-nums">{zone ? (zone.fee ? iqd(zone.fee) : 'مجاناً') : 'اختر المنطقة'}</span></div>
          <div className="flex items-baseline justify-between pt-1 text-lg font-extrabold"><span>الإجمالي</span><span className="tabular-nums">{zone ? iqd(total) : '—'}</span></div>
        </div>
        <Button type="submit" form="order" disabled={busy || !store.open}>
          <Banknote className="size-5" aria-hidden="true" />{busy ? 'جارٍ إرسال الطلب…' : store.open ? 'تأكيد الطلب · الدفع عند الاستلام' : 'الطلب متوقف مؤقتاً'}
        </Button>
      </>}>
      <div className="space-y-3">
        {!store.open && <Notice title="الطلب متوقف مؤقتاً">سنفتح الطلب قريباً، وتبقى سلتك محفوظة.</Notice>}
        {fail && store.open && <Notice title={fail.text}>{fail.diff && <p className="font-bold">{fail.diff}</p>}{fail.diff && <p>راجع الطلب ثم اضغط تأكيد من جديد.</p>}</Notice>}
        {notes.length > 0 && <Notice title="تحديث على سلتك" onClose={dismissNotes}>{notes.map((n) => <p key={n}>{n}</p>)}</Notice>}
      </div>

      <form id="order" onSubmit={submit} noValidate className="mt-4 space-y-5">
        <Field id="f-name" label="الاسم" error={errs.name}>
          <input id="f-name" className={field} value={f.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" maxLength={120}
            aria-invalid={!!errs.name} aria-describedby={errs.name ? 'f-name-err' : undefined} />
        </Field>
        <Field id="f-phone" label="رقم الموبايل" error={errs.phone} hint="سنتصل بك على هذا الرقم لتأكيد الطلب">
          <input id="f-phone" className={`${field} text-right`} dir="ltr" type="tel" inputMode="tel" autoComplete="tel" placeholder="07701234567"
            value={f.phone} onChange={(e) => set({ phone: e.target.value })} aria-invalid={!!errs.phone} aria-describedby={errs.phone ? 'f-phone-err' : undefined} />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[15px] font-bold">منطقة التوصيل</legend>
          {store.zones.length === 0 ? <Notice title="لا توجد مناطق توصيل متاحة حالياً">حاول لاحقاً.</Notice> : (
            <div className="grid gap-2" role="radiogroup" id="f-zone" tabIndex={-1} aria-invalid={!!errs.zone}>
              {store.zones.map((z) => (
                <label key={z.id} className={`flex min-h-12 cursor-pointer items-center justify-between rounded-2xl px-4 ring-1 transition has-[:checked]:bg-brand-soft has-[:checked]:ring-2 has-[:checked]:ring-brand has-[:focus-visible]:outline-3 ${errs.zone ? 'ring-red-500' : 'ring-stone-200'}`}>
                  <span className="flex items-center gap-3">
                    <input type="radio" name="zone" className="size-5 accent-[var(--brand)]" checked={f.zone === z.id} onChange={() => set({ zone: z.id })} />
                    <span className="font-medium">{z.name}</span>
                  </span>
                  <span className="text-[15px] tabular-nums text-stone-600">{z.fee ? iqd(z.fee) : 'مجاناً'}</span>
                </label>
              ))}
            </div>
          )}
          {errs.zone && <p className="mt-1.5 text-sm font-medium text-red-600">{errs.zone}</p>}
        </fieldset>
        <Field id="f-note" label="ملاحظة (اختياري)" hint="عنوان أدق أو أي تفصيل يساعد التوصيل">
          <textarea id="f-note" className={`${field} min-h-24 py-3`} rows={3} maxLength={500} value={f.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
      </form>

      <section className="mt-8" aria-label="ملخص الطلب">
        <h2 className="mb-2 font-bold">طلبك</h2>
        <ul className="divide-y divide-stone-100 rounded-2xl ring-1 ring-stone-200">
          {items.map(({ p, units }) => (
            <li key={p.id} className="flex items-start justify-between gap-3 p-3 text-[15px]">
              <span className="min-w-0"><span className="line-clamp-2">{p.name}</span><span className="text-sm text-stone-500">{unitsText(p, units)}</span></span>
              <span className="shrink-0 font-bold tabular-nums">{iqd(lineTotal(p, units))}</span>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  )
}
