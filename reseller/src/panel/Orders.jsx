import { useEffect, useState } from 'react'
import { errText } from '../lib/config'
import { iqd, num } from '../lib/format'
import { packName } from '../lib/qty'
import { Badge, Button, Notice, Sheet, field } from '../ui'
import { q, rpc, sb } from './sb'

export const STATUS = { new: ['جديد', 'brand'], confirmed: ['مؤكّد', 'warn'], delivered: ['تم التسليم', 'ok'], cancelled: ['ملغى', 'mute'] }
const when = (t) => new Date(t).toLocaleString('ar-IQ-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })
const qty = (i) => (i.pack_qty ? `${num(i.qty / i.pack_qty)} ${packName(i.pack_qty)}` : `${num(i.qty)} قطعة`)

export default function Orders(props) {
  const own = props.sub === 'own'
  return (
    <div>
      <div className="grid grid-cols-2 rounded-2xl bg-wash p-1" role="tablist">
        {[['#/orders', 'طلبات جاهزة', !own], ['#/orders/own', 'طلبات منتجاتي', own]].map(([h, l, on]) => (
          <a key={h} href={h} role="tab" aria-selected={on} className={`grid min-h-12 place-items-center rounded-xl text-[15px] ${on ? 'bg-card font-bold shadow-[var(--shadow-card)]' : 'font-medium text-mute'}`}>{l}</a>
        ))}
      </div>
      <div className="mt-6">{own ? <OwnOrders {...props} /> : <ReadyOrders {...props} />}</div>
    </div>
  )
}

function Card({ head, children, open, onToggle }) {
  return (
    <li className="overflow-hidden rounded-[22px] bg-card shadow-[var(--shadow-card)]">
      <button type="button" className="w-full p-5 text-start" aria-expanded={open} onClick={onToggle}>{head}</button>
      {open && <div className="border-t hairline px-5 pb-5 pt-4 text-[15px]">{children}</div>}
    </li>
  )
}

function ReadyOrders({ flash }) {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(null)
  const [cancel, setCancel] = useState(null)
  const [err, setErr] = useState(null)
  const load = () => rpc('reseller_my_orders', { p_limit: 50 }).then(setRows).catch((e) => setErr(errText(e)))
  useEffect(() => { load() }, [])

  if (err) return <Notice tone="bad">{err}</Notice>
  if (!rows) return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-24 rounded-[22px]" />)}</div>
  if (!rows.length) return <p className="py-16 text-center text-[16px] leading-8 text-mute">لا طلبات بعد.<br />عندما يطلب أحد من متجرك سيظهر هنا.</p>
  return (
    <div>
      <p className="mb-4 text-[14px] leading-6 text-ink-2">نجهّز هذه الطلبات ونوصّلها نحن. ربحك يصير متاحاً بعد التسليم بأيام.</p>
      <ul className="space-y-3">
        {rows.map((o) => (
          <Card key={o.order_id} open={open === o.order_id} onToggle={() => setOpen(open === o.order_id ? null : o.order_id)} head={
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="num text-[16px] font-extrabold">#{o.order_number}</span><Badge tone={STATUS[o.status]?.[1]}>{STATUS[o.status]?.[0] ?? o.status}</Badge></div>
                <p className="mt-1.5 text-[15px]">{o.customer_name} <span className="text-mute">· {o.delivery_zone}</span></p>
                <p className="text-[12px] text-mute">{when(o.created_at)}</p>
                {o.cancel_requested_at && <p className="mt-1.5 text-[13px] font-bold text-warn">طلبت الإلغاء — بانتظار الرد</p>}
              </div>
              <div className="text-end"><p className="num text-[16px] font-extrabold">{iqd(o.subtotal)}</p>
                <p className={`num text-[13px] ${o.status === 'cancelled' ? 'text-mute line-through' : 'font-bold text-brand-deep'}`}>ربحك {iqd(o.profit)}</p></div>
            </div>
          }>
            <ul className="space-y-2">{o.items.map((i, k) => <li key={k} className="flex justify-between gap-3"><span>{i.name} <span className="text-mute">· {qty(i)}</span></span><span className="num shrink-0">{iqd(i.price)}</span></li>)}</ul>
            <div className="mt-4 space-y-1 border-t hairline pt-4 text-ink-2">
              <p className="flex justify-between"><span>التوصيل</span><span className="num">{o.delivery_fee ? iqd(o.delivery_fee) : 'مجاناً'}</span></p>
              <p className="flex justify-between font-bold text-ink"><span>المطلوب من الزبون</span><span className="num">{iqd(o.total_amount)}</span></p>
            </div>
            {o.customer_phone && <p className="num mt-3" dir="ltr">{o.customer_phone}</p>}
            {['new', 'confirmed'].includes(o.status) && !o.cancel_requested_at && (
              <Button variant="quiet" className="mt-5" onClick={() => setCancel(o)}>طلب إلغاء الطلب</Button>
            )}
          </Card>
        ))}
      </ul>
      {cancel && <CancelSheet o={cancel} onClose={() => setCancel(null)} onDone={() => { setCancel(null); flash('أُرسل طلب الإلغاء'); load() }} />}
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
    <Sheet title={`إلغاء الطلب #${o.order_number}؟`} onClose={onClose}>
      <form onSubmit={go} className="space-y-5">
        <p className="leading-7 text-ink-2">نرسل طلبك للإدارة وهي تقرر. لن يتغيّر شيء حتى ترد.</p>
        {err && <Notice tone="bad">{err}</Notice>}
        <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} maxLength={300} placeholder="السبب (اختياري)" className={`${field} min-h-20 py-3`} />
        <Button variant="ink" type="submit" disabled={busy}>{busy ? 'لحظة…' : 'أرسل طلب الإلغاء'}</Button>
      </form>
    </Sheet>
  )
}

/** طلبات منتجاتي الخاصة: أوصلها أنا، وأرى هاتف الزبون */
function OwnOrders({ flash }) {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(null)
  const [err, setErr] = useState(null)
  const load = () => q(sb.from('reseller_own_orders').select('*').order('created_at', { ascending: false }).limit(50)).then(setRows).catch((e) => setErr(errText(e)))
  useEffect(() => { load() }, [])
  const move = async (o, s, msg) => { try { await rpc('reseller_own_order_set', { p_id: o.id, p_status: s }); flash(msg); load() } catch (e) { flash(errText(e)) } }

  if (err) return <Notice tone="bad">{err}</Notice>
  if (!rows) return <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-24 rounded-[22px]" />)}</div>
  if (!rows.length) return <p className="py-16 text-center text-[16px] leading-8 text-mute">لا طلبات لمنتجاتك الخاصة بعد.</p>
  return (
    <div>
      <p className="mb-4 text-[14px] leading-6 text-ink-2">هذه الطلبات توصلها أنت، وتستلم ثمنها وأجرة توصيلها من الزبون مباشرة.</p>
      <ul className="space-y-3">
        {rows.map((o) => (
          <Card key={o.id} open={open === o.id} onToggle={() => setOpen(open === o.id ? null : o.id)} head={
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="num text-[16px] font-extrabold">م{o.order_no}</span><Badge tone={STATUS[o.status][1]}>{STATUS[o.status][0]}</Badge></div>
                <p className="mt-1.5 text-[15px]">{o.customer_name} <span className="text-mute">· {o.zone}</span></p>
                <p className="text-[12px] text-mute">{when(o.created_at)}{o.main_order_number ? ` · مع الطلب #${o.main_order_number}` : ''}</p>
              </div>
              <p className="num text-[16px] font-extrabold">{iqd(o.total)}</p>
            </div>
          }>
            <a href={`tel:${o.customer_phone}`} className="num flex min-h-12 items-center justify-center rounded-2xl bg-wash text-[17px] font-bold" dir="ltr">{o.customer_phone}</a>
            {o.note && <p className="mt-3 rounded-2xl bg-wash px-4 py-3 text-ink-2">{o.note}</p>}
            <ul className="mt-4 space-y-2">{o.items.map((i, k) => <li key={k} className="flex justify-between gap-3"><span>{i.name} <span className="text-mute">· {num(i.qty)}</span></span><span className="num shrink-0">{iqd(i.line_total)}</span></li>)}</ul>
            <div className="mt-4 space-y-1 border-t hairline pt-4 text-ink-2">
              <p className="flex justify-between"><span>التوصيل</span><span className="num">{o.delivery_fee ? iqd(o.delivery_fee) : 'مجاناً'}</span></p>
              <p className="flex justify-between font-bold text-ink"><span>تستلم من الزبون</span><span className="num">{iqd(o.total)}</span></p>
            </div>
            <div className="mt-5 grid gap-2">
              {o.status === 'new' && <Button variant="ink" onClick={() => move(o, 'confirmed', 'أُكّد الطلب')}>تأكيد الطلب</Button>}
              {['new', 'confirmed'].includes(o.status) && <Button onClick={() => move(o, 'delivered', 'سُجّل التسليم')}>تم التسليم</Button>}
              {['new', 'confirmed'].includes(o.status) && <Button variant="quiet" onClick={() => confirm('إلغاء هذا الطلب؟') && move(o, 'cancelled', 'أُلغي الطلب')}>إلغاء الطلب</Button>}
            </div>
          </Card>
        ))}
      </ul>
    </div>
  )
}
