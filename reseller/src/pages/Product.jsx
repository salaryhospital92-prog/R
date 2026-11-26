import { useState } from 'react'
import { iqd } from '../lib/format'
import { inStock, lineTotal, maxUnits, minNote, minUnits, priceNote, unitsText } from '../lib/qty'
import { useShop } from '../lib/shop'
import { Button, Link, Notice, Page, ProductImage, Stepper } from '../ui'

export default function Product({ id }) {
  const { byId, items, cart, store } = useShop()
  const p = byId.get(id)
  const line = items.find((i) => i.p.id === id)
  const [units, setUnits] = useState(() => line?.units ?? (p ? minUnits(p) : 1))
  const [added, setAdded] = useState(false)

  if (!p) {
    return (
      <Page title={store.name} fallback="/">
        <div className="py-24 text-center">
          <p className="text-[20px] font-extrabold">هذا المنتج غير متوفر</p>
          <p className="mt-2 text-ink-2">ربما أُزيل من المتجر.</p>
          <Link to="/" className="mt-8 inline-flex min-h-13 items-center rounded-2xl bg-ink px-7 font-bold text-white">تصفّح المنتجات</Link>
        </div>
      </Page>
    )
  }
  const ok = inStock(p)
  const apply = () => { cart.setUnits(p, units); setAdded(true) }
  return (
    <Page title="" fallback="/"
      footer={ok && (
        <div className="flex items-center gap-3">
          <Stepper value={units} min={minUnits(p)} max={maxUnits(p)} label="الكمية" onChange={(u) => { setUnits(u); setAdded(false) }} />
          {added
            ? <Link to="/cart" className="flex min-h-13 flex-1 items-center justify-center rounded-2xl bg-ink px-4 font-bold text-white">إتمام الطلب</Link>
            : <Button variant="ink" onClick={apply} className="flex-1"><span>{line ? 'تحديث السلة' : 'أضف إلى السلة'}</span><span className="num font-light text-white/75">{iqd(lineTotal(p, units))}</span></Button>}
        </div>
      )}>
      <ProductImage p={p} className="rounded-[28px] shadow-[var(--shadow-card)]" />
      <div className="mt-7">
        <p className="eyebrow">{p.category}</p>
        <h2 className="mt-2 text-[24px] font-extrabold leading-9">{p.name}</h2>
        <p className="num mt-4 text-[30px] font-black">{iqd(p.price)}</p>
        {(p.pack_qty || minNote(p)) && <p className="mt-1 text-[15px] text-mute">{p.pack_qty ? priceNote(p) : minNote(p)}</p>}
        {p.own && <p className="mt-4 rounded-2xl bg-wash px-4 py-3 text-[14px] leading-6 text-ink-2">يصلك هذا المنتج من المتجر مباشرة، بتوصيل منفصل.</p>}
        {p.description && <p className="mt-6 whitespace-pre-line text-[16px] font-light leading-8 text-ink-2">{p.description}</p>}
        <div className="mt-6 space-y-3">
          {!ok && <Notice title="نفدت الكمية">سيتوفر قريباً.</Notice>}
          {added && <Notice tone="ok">أُضيف إلى السلة: {unitsText(p, units)}</Notice>}
        </div>
      </div>
    </Page>
  )
}
