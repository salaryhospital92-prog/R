import { useState } from 'react'
import { PackageX } from 'lucide-react'
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
        <div className="py-16 text-center">
          <PackageX className="mx-auto size-12 text-stone-300" aria-hidden="true" />
          <p className="mt-4 font-bold">هذا المنتج غير متوفر</p>
          <Link to="/" className="mt-6 inline-flex min-h-12 items-center rounded-2xl bg-brand px-6 font-bold text-brand-ink">تصفّح المنتجات</Link>
        </div>
      </Page>
    )
  }
  const ok = inStock(p)
  const apply = () => { cart.setUnits(p, units); setAdded(true) }
  return (
    <Page title={p.name} fallback="/"
      footer={ok && (
        <div className="flex items-center gap-3">
          <Stepper value={units} min={minUnits(p)} max={maxUnits(p)} label="الكمية" onChange={(u) => { setUnits(u); setAdded(false) }} />
          {added
            ? <Link to="/cart" className="flex min-h-12 flex-1 items-center justify-center rounded-2xl bg-brand px-4 font-bold text-brand-ink">عرض السلة</Link>
            : <Button onClick={apply} className="flex-1">{line ? 'تحديث السلة' : 'أضف للسلة'} · {iqd(lineTotal(p, units))}</Button>}
        </div>
      )}>
      <ProductImage p={p} className="rounded-3xl" />
      <div className="mt-5">
        <p className="text-sm text-stone-500">{p.category}</p>
        <h2 className="mt-1 text-xl font-extrabold leading-8">{p.name}</h2>
        <p className="mt-3 text-2xl font-extrabold tabular-nums">{iqd(p.price)}</p>
        <p className="mt-1 text-[15px] text-stone-500">{priceNote(p)}{minNote(p) && ` · ${minNote(p)}`}</p>
        {p.description && <p className="mt-5 whitespace-pre-line leading-7 text-stone-700">{p.description}</p>}
        <div className="mt-5 space-y-3">
          {!ok && <Notice title="نفد هذا المنتج">سيتوفر قريباً بإذن الله.</Notice>}
          {added && <Notice tone="ok">أُضيف إلى السلة: {unitsText(p, units)}</Notice>}
        </div>
      </div>
    </Page>
  )
}
