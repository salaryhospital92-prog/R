import { useMemo } from 'react'
import { iqd, num } from '../lib/format'
import { packName } from '../lib/qty'
import { useShop } from '../lib/shop'
import { Link, Redirect } from '../ui'

/** كمية بند من الردّ: qty بالقطع، وpack_qty إن بيع علباً */
const qtyOf = (it) => (it.pack_qty ? `${num(it.qty / it.pack_qty)} ${packName(it.pack_qty)}` : `${num(it.qty)} قطعة`)

function Part({ title, items, sub, feeLabel, fee }) {
  return (
    <section className="mt-6 overflow-hidden rounded-[22px] bg-card ring-1 ring-line">
      <p className="eyebrow px-5 pt-4">{title}</p>
      <ul className="divide-y hairline px-5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start justify-between gap-3 py-3.5 text-[15px]">
            <span className="min-w-0"><span className="line-clamp-2">{it.name}</span><span className="text-[13px] text-mute">{qtyOf(it)}</span></span>
            <span className="num shrink-0 font-bold">{iqd(it.line_total)}</span>
          </li>
        ))}
      </ul>
      <div className="space-y-1 bg-wash px-5 py-4 text-[15px] text-ink-2">
        <div className="flex justify-between"><span>المنتجات</span><span className="num">{iqd(sub)}</span></div>
        <div className="flex justify-between"><span>{feeLabel}</span><span className="num">{fee ? iqd(fee) : 'مجاناً'}</span></div>
      </div>
    </section>
  )
}

export default function Done() {
  const { slug, store } = useShop()
  const r = useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem(`receipt:${slug}`)) } catch { return null }
  }, [slug])
  if (!r || (!r.main && !r.own)) return <Redirect to="/" />

  const total = (r.main?.total_amount ?? 0) + (r.own?.total ?? 0)
  const numbers = [r.main?.order_number && `#${r.main.order_number}`, r.own?.order_no && `م${r.own.order_no}`].filter(Boolean)
  const wa = store.whatsapp && `https://wa.me/${store.whatsapp}?text=${encodeURIComponent(`طلبي رقم ${numbers.join(' و ')}`)}`
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5 pb-10 pt-14">
      <div className="rise text-center">
        <p className="eyebrow">تم استلام طلبك</p>
        <h1 className="mt-3 text-[30px] font-black leading-10">شكراً لك</h1>
        <p className="mt-3 text-[16px] text-ink-2">رقم الطلب <span className="num font-extrabold text-ink">{numbers.join(' · ')}</span></p>
        <p className="mt-2 text-[15px] leading-7 text-ink-2">سنتواصل معك على رقمك لتأكيد الطلب وموعد التوصيل.</p>
      </div>

      {r.main && <Part title={r.own ? 'الطلب الأول' : 'تفاصيل الطلب'} items={r.main.items} sub={r.main.subtotal} feeLabel={`التوصيل · ${r.main.delivery_zone}`} fee={r.main.delivery_fee} />}
      {r.own && <Part title="مختارات المتجر · توصيل منفصل" items={r.own.items} sub={r.own.subtotal} feeLabel="توصيل مختارات المتجر" fee={r.own.delivery_fee} />}

      <div className="mt-6 flex items-baseline justify-between rounded-[22px] bg-ink px-5 py-5 text-white">
        <span className="text-[16px] font-bold">المطلوب عند الاستلام</span><span className="num text-[22px] font-black">{iqd(total)}</span>
      </div>

      <div className="mt-8 space-y-3">
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="flex min-h-13 items-center justify-center rounded-2xl bg-card px-5 font-bold ring-1 ring-line">تواصل مع المتجر عبر واتساب</a>}
        <Link to="/" className="flex min-h-13 items-center justify-center rounded-2xl bg-brand px-5 font-bold text-brand-ink">متابعة التسوق</Link>
      </div>
    </div>
  )
}
