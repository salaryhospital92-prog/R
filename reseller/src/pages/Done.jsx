import { useMemo } from 'react'
import { CircleCheck, MessageCircle } from 'lucide-react'
import { iqd, num } from '../lib/format'
import { packName } from '../lib/qty'
import { useShop } from '../lib/shop'
import { Link, Redirect } from '../ui'

/** كمية بند من الردّ: qty بالقطع، وpack_qty إن بيع علباً */
const qtyOf = (it) => (it.pack_qty ? `${num(it.qty / it.pack_qty)} ${packName(it.pack_qty)}` : `${num(it.qty)} قطعة`)

export default function Done() {
  const { slug, store } = useShop()
  const r = useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem(`receipt:${slug}`)) } catch { return null }
  }, [slug])
  if (!r) return <Redirect to="/" />

  const wa = store.whatsapp && `https://wa.me/${store.whatsapp}?text=${encodeURIComponent(`طلبي رقم ${r.order_number}`)}`
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col bg-white px-4 py-10">
      <div className="rise text-center">
        <div className="mx-auto grid size-20 place-items-center rounded-full bg-brand-soft text-brand-deep"><CircleCheck className="size-11" aria-hidden="true" /></div>
        <h1 className="mt-5 text-2xl font-extrabold">تم استلام طلبك</h1>
        <p className="mt-2 text-lg text-stone-600">رقم الطلب <span className="font-extrabold tabular-nums text-stone-900">#{r.order_number}</span></p>
        <p className="mt-3 leading-7 text-stone-600">سنتصل بك على رقمك لتأكيد الطلب وموعد التوصيل.</p>
      </div>

      <section className="mt-8 rounded-2xl ring-1 ring-stone-200" aria-label="تفاصيل الطلب">
        <ul className="divide-y divide-stone-100">
          {r.items.map((it, i) => (
            <li key={i} className="flex items-start justify-between gap-3 p-3.5 text-[15px]">
              <span className="min-w-0"><span className="line-clamp-2">{it.name}</span><span className="text-sm text-stone-500">{qtyOf(it)}</span></span>
              <span className="shrink-0 font-bold tabular-nums">{iqd(it.line_total)}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-1.5 border-t border-stone-200 bg-stone-50 p-3.5 text-[15px]">
          <div className="flex justify-between text-stone-600"><span>المنتجات</span><span className="tabular-nums">{iqd(r.subtotal)}</span></div>
          <div className="flex justify-between text-stone-600"><span>التوصيل · {r.delivery_zone}</span><span className="tabular-nums">{r.delivery_fee ? iqd(r.delivery_fee) : 'مجاناً'}</span></div>
          <div className="flex items-baseline justify-between pt-1 text-lg font-extrabold"><span>المطلوب عند الاستلام</span><span className="tabular-nums">{iqd(r.total_amount)}</span></div>
        </div>
      </section>

      <div className="mt-8 space-y-3">
        {wa && (
          <a href={wa} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand-soft px-5 font-bold text-brand-deep">
            <MessageCircle className="size-5" aria-hidden="true" />تواصل مع المتجر عبر واتساب
          </a>
        )}
        <Link to="/" className="flex min-h-12 items-center justify-center rounded-2xl bg-brand px-5 font-bold text-brand-ink">متابعة التسوق</Link>
      </div>
    </div>
  )
}
