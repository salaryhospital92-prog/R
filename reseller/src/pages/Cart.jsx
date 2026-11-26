import { iqd } from '../lib/format'
import { lineTotal, maxUnits, minUnits, unitsText } from '../lib/qty'
import { go } from '../lib/route'
import { useShop } from '../lib/shop'
import { Button, Link, Notice, Page, ProductImage, Stepper } from '../ui'

function Lines({ list }) {
  const { cart } = useShop()
  return (
    <ul className="divide-y hairline">
      {list.map(({ p, units }) => (
        <li key={p.id} className="flex gap-4 py-5">
          <Link to={`/p/${p.id}`} className="w-22 shrink-0"><ProductImage p={p} className="rounded-2xl" /></Link>
          <div className="flex min-w-0 flex-1 flex-col">
            <Link to={`/p/${p.id}`} className="line-clamp-2 text-[15px] font-medium leading-6">{p.name}</Link>
            <p className="num mt-0.5 text-[13px] text-mute">{iqd(p.price)} · {unitsText(p, units)}</p>
            <div className="mt-auto flex items-center justify-between gap-2 pt-3">
              <Stepper size="sm" value={units} min={minUnits(p)} max={maxUnits(p)} label={p.name}
                onChange={(u) => cart.setUnits(p, u)} onRemove={() => cart.remove(p.id)} />
              <p className="num text-[16px] font-extrabold">{iqd(lineTotal(p, units))}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function Cart() {
  const { items, mainItems, ownItems, subtotal, store, notes, dismissNotes } = useShop()
  const noteBox = notes.length > 0 && <Notice title="تحديث على سلتك" onClose={dismissNotes}>{notes.map((n) => <p key={n}>{n}</p>)}</Notice>
  if (!items.length) {
    return (
      <Page title="السلة" fallback="/">
        {noteBox}
        <div className="py-24 text-center">
          <p className="text-[22px] font-extrabold">سلتك فارغة</p>
          <p className="mt-2 text-ink-2">أضف ما يعجبك من المنتجات.</p>
          <Link to="/" className="mt-8 inline-flex min-h-13 items-center rounded-2xl bg-ink px-7 font-bold text-white">تصفّح المنتجات</Link>
        </div>
      </Page>
    )
  }
  return (
    <Page title="السلة" fallback="/"
      footer={<>
        <div className="mb-4 flex items-baseline justify-between"><span className="text-ink-2">المجموع</span><span className="num text-[22px] font-black">{iqd(subtotal)}</span></div>
        <Button variant="ink" disabled={!store.open} onClick={() => go('/checkout')}>{store.open ? 'متابعة الطلب' : 'الطلب متوقف مؤقتاً'}</Button>
      </>}>
      <div className="space-y-3">
        {!store.open && <Notice title="الطلب متوقف مؤقتاً">تبقى منتجاتك في السلة، وتكمل الطلب لاحقاً.</Notice>}
        {noteBox}
      </div>
      {mainItems.length > 0 && <Lines list={mainItems} />}
      {ownItems.length > 0 && (
        <section className="mt-4">
          <p className="eyebrow">يصلك من المتجر مباشرة · توصيل منفصل</p>
          <Lines list={ownItems} />
        </section>
      )}
      <p className="mt-2 text-[13px] leading-6 text-mute">أجرة التوصيل تُضاف في الخطوة التالية. الدفع نقداً عند الاستلام.</p>
    </Page>
  )
}
