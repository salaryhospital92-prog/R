import { useRef, useState } from 'react'
import { checkout, errText } from '../lib/api'
import { iqd, phoneOf } from '../lib/format'
import { lineTotal, pieces, unitsText } from '../lib/qty'
import { go } from '../lib/route'
import { useShop } from '../lib/shop'
import { Button, Field, Notice, Page, Redirect, field } from '../ui'

const sum = (list, byId) => list.reduce((t, i) => t + lineTotal(byId ? byId(i.id) : i.p, i.units), 0)

export default function Checkout() {
  const { slug, store, items, mainItems, ownItems, refresh, cart, notes, dismissNotes } = useShop()
  const [f, setF] = useState({ name: '', phone: '', zone: 0, note: '' })
  const [errs, setErrs] = useState({})
  const [fail, setFail] = useState(null)        // {text, diff}
  const [busy, setBusy] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  const lock = useRef(false)
  const zone = store.zones.find((z) => z.id === f.zone)
  const mainSub = sum(mainItems), ownSub = sum(ownItems)
  const mainFee = mainItems.length && zone ? zone.fee : 0
  const ownFee = ownItems.length ? store.own_fee : 0
  const total = mainSub + ownSub + mainFee + ownFee
  const set = (patch) => { setF({ ...f, ...patch }); setErrs({ ...errs, ...Object.fromEntries(Object.keys(patch).map((k) => [k, null])) }) }

  if (!items.length) return <Redirect to="/cart" />

  const submit = async (e) => {
    e.preventDefault()
    if (lock.current) return
    const phone = phoneOf(f.phone)
    const next = {
      name: f.name.trim().length < 2 ? 'اكتب اسمك' : null,
      phone: phone ? null : 'أدخل رقم موبايل عراقي صحيح، مثل 07701234567',
      zone: zone ? null : 'اختر منطقة التوصيل',
    }
    setErrs(next)
    const bad = Object.keys(next).find((k) => next[k])
    if (bad) { document.getElementById(`f-${bad}`)?.focus(); return }

    lock.current = true; setBusy(true); setFail(null)
    try {
      const r = await checkout(slug, {
        name: f.name.trim(), phone, zone: zone.id, note: f.note.trim(),
        items: mainItems.map(({ p, units }) => ({ product_id: p.id, qty: pieces(p, units) })),   // القطع لا الوحدات
        ownItems: ownItems.map(({ p, units }) => ({ product_id: p.id, qty: units })),
        expected: mainItems.length ? mainSub + mainFee : null,
        expectedOwn: ownItems.length ? ownSub + ownFee : null,
      })
      try { sessionStorage.setItem(`receipt:${slug}`, JSON.stringify({ ...r, zone: zone.name })) } catch { /* يبقى في الذاكرة فقط */ }
      cart.clear(); dismissNotes()
      go('/done', { replace: true })
    } catch (err) {
      const text = errText(err)
      // أي رفض من الخادم قد يعني أن الأسعار أو المخزون أو المناطق تغيّرت: نزامن ثم نريه الفرق
      const fresh = err?.code === 'P0001' ? await refresh() : null
      let diff = null
      if (fresh) {
        const nz = fresh.store.zones.find((z) => z.id === f.zone)
        const price = (id) => fresh.products.find((p) => p.id === id)
        const nr = fresh.lines.filter((l) => !price(l.id)?.own), no = fresh.lines.filter((l) => price(l.id)?.own)
        const nt = sum(nr, price) + sum(no, price) + (nr.length ? nz?.fee ?? 0 : 0) + (no.length ? fresh.store.own_fee : 0)
        if (nt !== total) diff = `الإجمالي كان ${iqd(total)} وأصبح ${iqd(nt)}`
        if (!nz && f.zone) setF((x) => ({ ...x, zone: 0 }))
      }
      setFail({ text, diff })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      lock.current = false; setBusy(false)
    }
  }

  const row = (label, value, strong) => (
    <div className={`flex items-baseline justify-between ${strong ? 'pt-2 text-[18px] font-black text-ink' : 'text-[15px] text-ink-2'}`}><span>{label}</span><span className="num">{value}</span></div>
  )
  return (
    <Page title="إتمام الطلب" fallback="/cart"
      footer={<>
        <div className="mb-4 space-y-1.5">
          {row('المنتجات', iqd(mainSub + ownSub))}
          {mainItems.length > 0 && row('التوصيل', zone ? (zone.fee ? iqd(zone.fee) : 'مجاناً') : 'اختر المنطقة')}
          {ownItems.length > 0 && row('توصيل مختارات المتجر', ownFee ? iqd(ownFee) : 'مجاناً')}
          {row('الإجمالي عند الاستلام', zone ? iqd(total) : '—', true)}
        </div>
        <Button variant="ink" type="submit" form="order" disabled={busy || !store.open}>
          {busy ? 'جارٍ إرسال الطلب…' : store.open ? 'تأكيد الطلب' : 'الطلب متوقف مؤقتاً'}
        </Button>
      </>}>
      <div className="space-y-3">
        {!store.open && <Notice title="الطلب متوقف مؤقتاً">سنفتح الطلب قريباً، وتبقى سلتك محفوظة.</Notice>}
        {fail && store.open && <Notice tone="bad" title={fail.text}>{fail.diff && <p className="font-bold text-ink">{fail.diff}</p>}{fail.diff && <p>راجع الطلب ثم اضغط تأكيد من جديد.</p>}</Notice>}
        {notes.length > 0 && <Notice title="تحديث على سلتك" onClose={dismissNotes}>{notes.map((n) => <p key={n}>{n}</p>)}</Notice>}
      </div>

      <form id="order" onSubmit={submit} noValidate className="mt-2 space-y-6">
        <Field id="f-name" label="الاسم" error={errs.name}>
          <input id="f-name" className={field} value={f.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" maxLength={120}
            aria-invalid={!!errs.name} aria-describedby={errs.name ? 'f-name-err' : undefined} />
        </Field>
        <Field id="f-phone" label="رقم الموبايل" error={errs.phone} hint="للتواصل بخصوص الطلب">
          <input id="f-phone" className={`${field} num text-right`} dir="ltr" type="tel" inputMode="tel" autoComplete="tel" placeholder="07701234567"
            value={f.phone} onChange={(e) => set({ phone: e.target.value })} aria-invalid={!!errs.phone} aria-describedby={errs.phone ? 'f-phone-err' : undefined} />
        </Field>
        <fieldset>
          <legend className="mb-2 text-[14px] font-bold text-ink-2">منطقة التوصيل</legend>
          {store.zones.length === 0 ? <Notice title="لا توجد مناطق توصيل متاحة حالياً">حاول لاحقاً.</Notice> : (
            <div className="grid gap-2" role="radiogroup" id="f-zone" tabIndex={-1} aria-invalid={!!errs.zone}>
              {store.zones.map((z) => (
                <label key={z.id} className={`flex min-h-14 cursor-pointer items-center justify-between rounded-2xl bg-card px-5 ring-1 transition has-[:checked]:ring-2 has-[:checked]:ring-ink ${errs.zone ? 'ring-bad' : 'ring-line'}`}>
                  <span className="flex items-center gap-3">
                    <input type="radio" name="zone" className="size-5 accent-[var(--color-ink)]" checked={f.zone === z.id} onChange={() => set({ zone: z.id })} />
                    <span className="text-[16px] font-medium">{z.name}</span>
                  </span>
                  {mainItems.length > 0 && <span className="num text-[14px] text-mute">{z.fee ? iqd(z.fee) : 'مجاناً'}</span>}
                </label>
              ))}
            </div>
          )}
          {errs.zone && <p className="mt-2 text-[14px] font-medium text-bad">{errs.zone}</p>}
        </fieldset>
        {noteOpen || f.note ? (
          <Field id="f-note" label="ملاحظة" hint="عنوان أدق أو أي تفصيل يساعد التوصيل">
            <textarea id="f-note" className={`${field} min-h-24 py-3`} rows={3} maxLength={500} value={f.note} onChange={(e) => set({ note: e.target.value })} autoFocus={noteOpen && !f.note} />
          </Field>
        ) : (
          <button type="button" onClick={() => setNoteOpen(true)} className="min-h-11 text-[15px] font-bold text-ink underline decoration-line decoration-2 underline-offset-8">إضافة ملاحظة للتوصيل</button>
        )}
      </form>

      <section className="mt-10" aria-label="ملخص الطلب">
        <h2 className="text-[17px] font-extrabold">طلبك</h2>
        {[[mainItems, null], [ownItems, 'يصلك من المتجر مباشرة · توصيل منفصل']].filter(([l]) => l.length).map(([list, label]) => (
          <div key={label ?? 'r'} className="mt-3">
            {label && <p className="eyebrow mb-2">{label}</p>}
            <ul className="divide-y hairline rounded-2xl bg-card px-4 ring-1 ring-line">
              {list.map(({ p, units }) => (
                <li key={p.id} className="flex items-start justify-between gap-3 py-3.5 text-[15px]">
                  <span className="min-w-0"><span className="line-clamp-2">{p.name}</span><span className="text-[13px] text-mute">{unitsText(p, units)}</span></span>
                  <span className="num shrink-0 font-bold">{iqd(lineTotal(p, units))}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </Page>
  )
}
