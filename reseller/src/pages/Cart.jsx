import { ShoppingBag } from 'lucide-react'
import { iqd } from '../lib/format'
import { lineTotal, maxUnits, minUnits, priceNote, unitsText } from '../lib/qty'
import { go } from '../lib/route'
import { useShop } from '../lib/shop'
import { Button, Link, Notice, Page, ProductImage, Stepper } from '../ui'

export default function Cart() {
  const { items, cart, subtotal, store, notes, dismissNotes } = useShop()
  const noteBox = notes.length > 0 && (
    <Notice title="تحديث على سلتك" onClose={dismissNotes}>{notes.map((n) => <p key={n}>{n}</p>)}</Notice>
  )
  if (!items.length) {
    return (
      <Page title="السلة" fallback="/">
        {noteBox}
        <div className="py-16 text-center">
          <ShoppingBag className="mx-auto size-12 text-stone-300" aria-hidden="true" />
          <p className="mt-4 text-lg font-bold">سلتك فارغة</p>
          <Link to="/" className="mt-6 inline-flex min-h-12 items-center rounded-2xl bg-brand px-6 font-bold text-brand-ink">تصفّح المنتجات</Link>
        </div>
      </Page>
    )
  }
  return (
    <Page title="السلة" fallback="/"
      footer={<>
        <div className="mb-3 flex items-baseline justify-between"><span className="text-stone-600">المجموع</span><span className="text-xl font-extrabold tabular-nums">{iqd(subtotal)}</span></div>
        <Button disabled={!store.open} onClick={() => go('/checkout')}>{store.open ? 'متابعة الطلب' : 'الطلب متوقف مؤقتاً'}</Button>
      </>}>
      <div className="space-y-3">
        {!store.open && <Notice title="الطلب متوقف مؤقتاً">يمكنك إبقاء المنتجات في السلة وإكمال الطلب لاحقاً.</Notice>}
        {noteBox}
      </div>
      <ul className="mt-4 divide-y divide-stone-100">
        {items.map(({ p, units }) => (
          <li key={p.id} className="flex gap-3 py-4">
            <Link to={`/p/${p.id}`} className="w-20 shrink-0"><ProductImage p={p} className="rounded-xl" /></Link>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Link to={`/p/${p.id}`} className="line-clamp-2 font-medium leading-6">{p.name}</Link>
              <p className="text-[13px] text-stone-500">{iqd(p.price)} · {priceNote(p)}</p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <Stepper value={units} min={minUnits(p)} max={maxUnits(p)} label={p.name}
                  onChange={(u) => cart.setUnits(p, u)} onRemove={() => cart.remove(p.id)} />
                <div className="text-end">
                  <p className="text-[13px] text-stone-500">{unitsText(p, units)}</p>
                  <p className="font-extrabold tabular-nums">{iqd(lineTotal(p, units))}</p>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm leading-6 text-stone-500">أجرة التوصيل تُضاف في الخطوة التالية حسب منطقتك. الدفع نقداً عند الاستلام.</p>
    </Page>
  )
}
