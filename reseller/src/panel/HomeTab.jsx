import { useEffect, useState } from 'react'
import { errText } from '../lib/config'
import { iqd } from '../lib/format'
import { Badge, Button, Notice } from '../ui'
import { nav, rpc, storeUrl } from './sb'
import { STATUS } from './Orders'

export default function HomeTab({ store, reload, flash }) {
  const [bal, setBal] = useState(null)
  const [orders, setOrders] = useState(null)
  const [busy, setBusy] = useState(false)
  const url = storeUrl(store.slug)

  useEffect(() => {
    rpc('reseller_balance').then(setBal).catch(() => {})
    rpc('reseller_my_orders', { p_limit: 3 }).then(setOrders).catch(() => setOrders([]))
  }, [])
  // بانتظار الموافقة: نفحص كل 20 ثانية فيتحول المتجر وحده عند التفعيل
  useEffect(() => {
    if (store.status !== 'pending') return
    const t = setInterval(reload, 20000)
    return () => clearInterval(t)
  }, [store.status, reload])

  const copy = async () => { try { await navigator.clipboard.writeText(url); flash('نُسخ الرابط') } catch { flash('انسخ الرابط يدوياً') } }
  const share = () => (navigator.share ? navigator.share({ title: store.name, url }).catch(() => {}) : window.open(`https://wa.me/?text=${encodeURIComponent(`${store.name}\n${url}`)}`, '_blank', 'noopener'))
  const resubmit = async () => {
    setBusy(true)
    try { await rpc('reseller_submit_store'); await reload(); flash('أُرسل للمراجعة') } catch (e) { flash(errText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-7">
      {store.status === 'pending' && (
        <section className="rounded-[24px] bg-card p-6 shadow-[var(--shadow-card)]">
          <Badge tone="warn">قيد المراجعة</Badge>
          <h2 className="mt-3 text-[22px] font-black leading-8">نراجع متجرك الآن</h2>
          <p className="mt-2 text-[15px] leading-7 text-ink-2">سيعمل رابطك فور الموافقة. في هذه الأثناء اضبط أسعارك وأضف منتجاتك الخاصة إن أردت.</p>
          <Button variant="quiet" className="mt-5" onClick={() => nav('#/products')}>ضبط المنتجات والأسعار</Button>
        </section>
      )}
      {store.status === 'rejected' && (
        <div className="space-y-3">
          <Notice tone="bad" title="لم تتم الموافقة على متجرك">{store.status_reason || 'راجع اسم المتجر وشعاره من الإعدادات ثم أعد الإرسال.'}</Notice>
          <Button variant="ink" disabled={busy} onClick={resubmit}>إعادة الإرسال للمراجعة</Button>
        </div>
      )}
      {store.status === 'active' && (
        <section className="rounded-[24px] bg-ink p-6 text-white" aria-label="رابط متجرك">
          <p className="text-[13px] font-bold text-white/60">رابط متجرك</p>
          <p dir="ltr" className="mt-1.5 break-all text-start text-[19px] font-extrabold">{url.replace(/^https?:\/\//, '')}</p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <button type="button" onClick={copy} className="min-h-12 rounded-2xl bg-white/10 text-[14px] font-bold hover:bg-white/15">نسخ</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`${store.name}\n${url}`)}`} target="_blank" rel="noopener noreferrer" className="grid min-h-12 place-items-center rounded-2xl bg-white/10 text-[14px] font-bold hover:bg-white/15">واتساب</a>
            <button type="button" onClick={share} className="min-h-12 rounded-2xl bg-white text-[14px] font-bold text-ink">مشاركة</button>
          </div>
        </section>
      )}

      {bal && (
        <section className="grid grid-cols-2 gap-3" aria-label="أرباحك">
          {[['متاح للاستلام', bal.available, true], ['قيد الانتظار', bal.pending + bal.held]].map(([t, v, main]) => (
            <button key={t} type="button" onClick={() => nav('#/money')} className="rounded-[22px] bg-card p-5 text-start shadow-[var(--shadow-card)]">
              <p className="text-[13px] text-mute">{t}</p><p className={`num mt-1 text-[22px] font-black ${main ? 'text-brand-deep' : ''}`}>{iqd(v)}</p>
            </button>
          ))}
        </section>
      )}

      <section aria-label="آخر الطلبات">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-[17px] font-extrabold">آخر الطلبات</h2>
          <button type="button" onClick={() => nav('#/orders')} className="min-h-11 px-1 text-[14px] font-bold underline decoration-line decoration-2 underline-offset-8">عرض الكل</button></div>
        {orders === null ? <div className="skeleton h-20 rounded-[22px]" /> : orders.length === 0 ? (
          <p className="rounded-[22px] bg-card p-6 text-center text-[15px] leading-7 text-ink-2 shadow-[var(--shadow-card)]">لا طلبات بعد. شارك رابط متجرك مع أصدقائك وزبائنك لتبدأ.</p>
        ) : (
          <ul className="divide-y hairline rounded-[22px] bg-card px-5 shadow-[var(--shadow-card)]">{orders.map((o) => (
            <li key={o.order_id} className="flex items-center justify-between gap-3 py-4">
              <span className="min-w-0"><span className="num font-extrabold">#{o.order_number}</span> <span className="text-ink-2">· {o.customer_name}</span><br /><Badge tone={STATUS[o.status]?.[1]}>{STATUS[o.status]?.[0] ?? o.status}</Badge></span>
              <span className="text-end"><span className="num block font-extrabold">{iqd(o.subtotal)}</span><span className="num text-[13px] font-bold text-brand-deep">ربحك {iqd(o.profit)}</span></span>
            </li>))}</ul>
        )}
      </section>
    </div>
  )
}
