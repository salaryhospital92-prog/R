import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { errText } from '../lib/config'
import { iqd, num } from '../lib/format'
import { packName } from '../lib/qty'
import { Button, Notice } from '../ui'
import { rpc } from './sb'
import { STATUS } from './HomeTab'

const TONE = { new: 'bg-sky-100 text-sky-900', confirmed: 'bg-amber-100 text-amber-900', delivered: 'bg-emerald-100 text-emerald-900', cancelled: 'bg-stone-200 text-stone-600' }
const when = (t) => new Date(t).toLocaleString('ar-IQ-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })
const qty = (i) => (i.pack_qty ? `${num(i.qty / i.pack_qty)} ${packName(i.pack_qty)}` : `${num(i.qty)} قطعة`)

export default function Orders({ flash }) {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(null)
  const [cancel, setCancel] = useState(null)
  const [err, setErr] = useState(null)
  const load = () => rpc('reseller_my_orders', { p_limit: 50 }).then(setRows).catch((e) => setErr(errText(e)))
  useEffect(() => { load() }, [])

  if (err) return <Notice>{err}</Notice>
  if (!rows) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div>
  if (!rows.length) return <p className="py-16 text-center leading-7 text-stone-600">لا طلبات بعد.<br />عندما يطلب أحد من متجرك سيظهر هنا.</p>

  return (
    <div>
      <p className="mb-3 text-sm leading-6 text-stone-500">نجهّز الطلب ونوصّله نحن. ربحك يصير متاحاً بعد التسليم بعدة أيام.</p>
      <ul className="space-y-3">
        {rows.map((o) => (
          <li key={o.order_id} className="rounded-2xl ring-1 ring-stone-200">
            <button type="button" className="flex w-full items-start gap-3 p-4 text-start" aria-expanded={open === o.order_id} onClick={() => setOpen(open === o.order_id ? null : o.order_id)}>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><b className="tabular-nums">#{o.order_number}</b>
                  <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-bold ${TONE[o.status] ?? ''}`}>{STATUS[o.status] ?? o.status}</span></span>
                <span className="mt-1 block text-[15px]">{o.customer_name} · {o.delivery_zone}</span>
                <span className="text-[13px] text-stone-500">{when(o.created_at)}</span>
                {o.cancel_requested_at && <span className="mt-1 block text-[13px] font-bold text-amber-700">طلبت الإلغاء — بانتظار الرد</span>}
              </span>
              <span className="text-end"><b className="block tabular-nums">{iqd(o.subtotal)}</b>
                <span className={`text-sm tabular-nums ${o.status === 'cancelled' ? 'text-stone-400 line-through' : 'font-bold text-brand-deep'}`}>ربحك {iqd(o.profit)}</span></span>
              <ChevronDown className={`mt-1 size-5 shrink-0 text-stone-400 transition ${open === o.order_id ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {open === o.order_id && (
              <div className="border-t border-stone-100 p-4 text-[15px]">
                <ul className="space-y-1.5">{o.items.map((i, k) => <li key={k} className="flex justify-between gap-3"><span>{i.name} <span className="text-stone-500">· {qty(i)}</span></span><span className="shrink-0 tabular-nums">{iqd(i.price)}</span></li>)}</ul>
                <div className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-stone-600">
                  <p className="flex justify-between"><span>التوصيل</span><span className="tabular-nums">{o.delivery_fee ? iqd(o.delivery_fee) : 'مجاناً'}</span></p>
                  <p className="flex justify-between font-bold text-stone-900"><span>المطلوب من الزبون</span><span className="tabular-nums">{iqd(o.total_amount)}</span></p>
                </div>
                {o.customer_phone && <p className="mt-3" dir="ltr">{o.customer_phone}</p>}
                {['new', 'confirmed'].includes(o.status) && !o.cancel_requested_at && (
                  <button type="button" onClick={() => setCancel(o)} className="mt-4 min-h-12 w-full rounded-2xl bg-stone-100 font-bold text-stone-700">طلب إلغاء الطلب</button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {cancel && <CancelSheet o={cancel} onClose={() => setCancel(null)} onDone={() => { setCancel(null); flash('أُرسل طلب الإلغاء ✓'); load() }} />}
    </div>
  )
}

function CancelSheet({ o, onClose, onDone }) {
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { await rpc('reseller_request_cancel', { p_order_id: o.order_id, p_reason: why.trim() || 'بلا سبب' }); onDone() } catch (x) { setErr(errText(x)) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose} role="dialog" aria-modal="true" aria-label="طلب إلغاء">
      <form onSubmit={go} onClick={(e) => e.stopPropagation()} className="rise mx-auto w-full max-w-2xl space-y-4 rounded-t-3xl bg-white p-5 safe-b">
        <h2 className="text-lg font-extrabold">إلغاء الطلب #{o.order_number}؟</h2>
        <p className="leading-7 text-stone-600">نرسل طلبك للإدارة وهي تقرر. لن يتغيّر شيء حتى ترد.</p>
        {err && <Notice>{err}</Notice>}
        <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} maxLength={300} placeholder="السبب (اختياري)" className="min-h-20 w-full rounded-2xl bg-stone-100 p-4 outline-none focus:ring-2 focus:ring-brand" />
        <div className="flex gap-3"><Button type="submit" disabled={busy}>{busy ? 'لحظة…' : 'أرسل طلب الإلغاء'}</Button>
          <button type="button" onClick={onClose} className="min-h-12 shrink-0 rounded-2xl bg-stone-100 px-5 font-bold">رجوع</button></div>
      </form>
    </div>
  )
}
