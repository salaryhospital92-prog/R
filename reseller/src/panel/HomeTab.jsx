import { useEffect, useState } from 'react'
import { Clock, Copy, MessageCircle, Share2 } from 'lucide-react'
import { errText } from '../lib/config'
import { iqd } from '../lib/format'
import { Button, Notice } from '../ui'
import { nav, rpc, storeUrl } from './sb'

export const STATUS = { new: 'جديد', confirmed: 'مؤكّد', delivered: 'تم التسليم', cancelled: 'ملغى' }

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

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); flash('نُسخ الرابط ✓') } catch { flash('انسخ الرابط يدوياً') }
  }
  const share = () => (navigator.share ? navigator.share({ title: store.name, url }).catch(() => {}) : window.open(`https://wa.me/?text=${encodeURIComponent(`${store.name}\n${url}`)}`, '_blank', 'noopener'))
  const resubmit = async () => {
    setBusy(true)
    try { await rpc('reseller_submit_store'); await reload(); flash('أُرسل للمراجعة ✓') } catch (e) { flash(errText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      {store.status === 'pending' && (
        <div className="rounded-3xl bg-amber-50 p-5 ring-1 ring-amber-200">
          <Clock className="size-7 text-amber-700" aria-hidden="true" />
          <h2 className="mt-2 text-lg font-extrabold">متجرك قيد المراجعة</h2>
          <p className="mt-1 leading-7 text-stone-700">نراجعه الآن، وسيعمل رابطك فور الموافقة. يمكنك في هذه الأثناء ضبط الأسعار واختيار المنتجات.</p>
        </div>
      )}
      {store.status === 'rejected' && (
        <div className="space-y-3">
          <Notice title="لم تتم الموافقة على متجرك">{store.status_reason || 'راجع اسم المتجر وشعاره من «المزيد ← الإعدادات» ثم أعد الإرسال.'}</Notice>
          <Button disabled={busy} onClick={resubmit}>إعادة الإرسال للمراجعة</Button>
        </div>
      )}
      {store.status === 'active' && (
        <section className="rounded-3xl bg-brand-soft p-5" aria-label="رابط متجرك">
          <p className="text-sm font-bold text-brand-deep">رابط متجرك</p>
          <p dir="ltr" className="mt-1 break-all text-start text-lg font-extrabold">{url.replace(/^https?:\/\//, '')}</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button type="button" onClick={copy} className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl bg-white text-[13px] font-bold"><Copy className="size-5" aria-hidden="true" />نسخ</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`${store.name}\n${url}`)}`} target="_blank" rel="noopener noreferrer" className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl bg-white text-[13px] font-bold"><MessageCircle className="size-5" aria-hidden="true" />واتساب</a>
            <button type="button" onClick={share} className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl bg-white text-[13px] font-bold"><Share2 className="size-5" aria-hidden="true" />مشاركة</button>
          </div>
        </section>
      )}

      {bal && (
        <section className="grid grid-cols-2 gap-3" aria-label="أرباحك">
          <button type="button" onClick={() => nav('#/money')} className="rounded-2xl bg-stone-50 p-4 text-start ring-1 ring-stone-200"><p className="text-sm text-stone-500">متاح للاستلام</p><p className="mt-1 text-xl font-extrabold tabular-nums">{iqd(bal.available)}</p></button>
          <button type="button" onClick={() => nav('#/money')} className="rounded-2xl bg-stone-50 p-4 text-start ring-1 ring-stone-200"><p className="text-sm text-stone-500">قيد الانتظار</p><p className="mt-1 text-xl font-extrabold tabular-nums">{iqd(bal.pending + bal.held)}</p></button>
        </section>
      )}

      <section aria-label="آخر الطلبات">
        <div className="mb-2 flex items-center justify-between"><h2 className="font-extrabold">آخر الطلبات</h2><button type="button" onClick={() => nav('#/orders')} className="min-h-11 px-1 text-[15px] font-bold text-brand-deep">عرض الكل</button></div>
        {orders === null ? <div className="skeleton h-20 rounded-2xl" /> : orders.length === 0 ? (
          <p className="rounded-2xl bg-stone-50 p-5 text-center leading-7 text-stone-600">لا طلبات بعد. شارك رابط متجرك مع أصدقائك وزبائنك لتبدأ.</p>
        ) : (
          <ul className="space-y-2">{orders.map((o) => (
            <li key={o.order_id} className="flex items-center justify-between rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-200">
              <span><span className="font-bold tabular-nums">#{o.order_number}</span> <span className="text-stone-600">· {o.customer_name}</span><br /><span className="text-sm text-stone-500">{STATUS[o.status] ?? o.status}</span></span>
              <span className="text-end"><span className="block font-extrabold tabular-nums">{iqd(o.subtotal)}</span><span className="text-sm text-brand-deep tabular-nums">ربحك {iqd(o.profit)}</span></span>
            </li>))}</ul>
        )}
      </section>
    </div>
  )
}
