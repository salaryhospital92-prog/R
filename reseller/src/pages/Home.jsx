import { useMemo, useState } from 'react'
import { iqd, norm } from '../lib/format'
import { inStock, maxUnits, minNote, minUnits, priceNote } from '../lib/qty'
import { useShop } from '../lib/shop'
import { Link, Logo, Notice, ProductImage, Stepper } from '../ui'

const PAGE = 40

function Card({ p }) {
  const { items, cart } = useShop()
  const line = items.find((i) => i.p.id === p.id)
  const ok = inStock(p)
  return (
    <li className="group flex flex-col">
      <Link to={`/p/${p.id}`} className="block overflow-hidden rounded-[20px] bg-card shadow-[var(--shadow-card)]" aria-label={p.name}>
        <ProductImage p={p} className={`transition duration-300 group-hover:scale-[1.02] ${ok ? '' : 'opacity-45 grayscale'}`} />
      </Link>
      <div className="flex flex-1 flex-col px-1 pt-3">
        <Link to={`/p/${p.id}`} className="line-clamp-2 min-h-11 text-[15px] font-medium leading-[22px] text-ink">{p.name}</Link>
        <p className="num mt-1.5 text-[18px] font-extrabold">{iqd(p.price)}</p>
        <p className="min-h-5 text-[12.5px] leading-5 text-mute">{p.pack_qty ? priceNote(p) : minNote(p)}</p>
        <div className="mt-auto pt-3">
          {!ok ? <p className="grid min-h-12 place-items-center rounded-full bg-wash text-[14px] font-bold text-mute">نفدت الكمية</p>
            : line ? <Stepper size="sm" value={line.units} min={minUnits(p)} max={maxUnits(p)} label={p.name}
                onChange={(u) => cart.setUnits(p, u)} onRemove={() => cart.remove(p.id)} />
            : <button type="button" onClick={() => cart.setUnits(p, minUnits(p))}
                className="min-h-12 w-full rounded-full bg-ink text-[14px] font-bold text-white transition active:scale-[.98]">
                أضف إلى السلة
              </button>}
        </div>
      </div>
    </li>
  )
}

export default function Home() {
  const { store, products, count, subtotal, filter, setFilter, notes, dismissNotes } = useShop()
  const [more, setMore] = useState(PAGE)
  const [aboutOpen, setAboutOpen] = useState(false)
  const cats = useMemo(() => {
    const m = new Map()
    products.forEach((p) => m.set(p.category_id, p.category))
    return [...m].sort((a, b) => (a[0] < 0 ? -1 : b[0] < 0 ? 1 : a[1].localeCompare(b[1], 'ar')))
  }, [products])
  const list = useMemo(() => {
    const q = norm(filter.q).trim()
    return products.filter((p) => (!filter.cat || p.category_id === filter.cat) && (!q || norm(p.name).includes(q)))
  }, [products, filter])
  const set = (patch) => { setFilter({ ...filter, ...patch }); setMore(PAGE) }

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-32">
      <header className="px-5 pt-7">
        <div className="flex items-center gap-4">
          <Logo store={store} size={56} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[24px] font-black leading-8">{store.name}</h1>
            <p className="text-[13px] text-mute">الدفع نقداً عند الاستلام</p>
          </div>
        </div>
        {store.about && (
          <button type="button" onClick={() => setAboutOpen(!aboutOpen)} className="mt-4 block w-full text-start text-[15px] font-light leading-7 text-ink-2">
            <span className={aboutOpen ? '' : 'line-clamp-2'}>{store.about}</span>
          </button>
        )}
        {store.whatsapp && (
          <a href={`https://wa.me/${store.whatsapp}`} target="_blank" rel="noopener noreferrer"
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-card px-4 text-[14px] font-bold text-ink ring-1 ring-line">تواصل معنا عبر واتساب</a>
        )}
        <div className="mt-4 space-y-3">
          {!store.open && <Notice title="الطلب متوقف مؤقتاً">يمكنك تصفح المنتجات، وسنفتح الطلب قريباً.</Notice>}
          {notes.length > 0 && <Notice title="تحديث على سلتك" onClose={dismissNotes}>{notes.map((n) => <p key={n}>{n}</p>)}</Notice>}
        </div>
      </header>

      <div className="sticky top-0 z-20 mt-5 bg-paper/92 px-5 pb-3 pt-3 backdrop-blur">
        <label className="block">
          <span className="sr-only">ابحث عن منتج</span>
          <input type="search" value={filter.q} onChange={(e) => set({ q: e.target.value })} placeholder="ابحث عن منتج" enterKeyHint="search"
            className="h-13 w-full rounded-2xl bg-card px-5 shadow-[var(--shadow-card)] outline-none ring-1 ring-line transition placeholder:text-mute focus:ring-brand" />
        </label>
        {cats.length > 1 && (
          <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5" role="tablist" aria-label="الأصناف">
            {[[0, 'الكل'], ...cats].map(([id, name]) => (
              <button key={id} type="button" role="tab" aria-selected={filter.cat === id} onClick={() => set({ cat: id })}
                className={`min-h-11 shrink-0 rounded-full px-5 text-[14px] transition ${filter.cat === id ? 'bg-ink font-bold text-white' : 'bg-card font-medium text-ink-2 ring-1 ring-line'}`}>{name}</button>
            ))}
          </div>
        )}
      </div>

      <main className="px-5 pt-3">
        {list.length === 0 ? (
          <p className="py-20 text-center text-[16px] text-mute">{products.length ? 'لا نتائج مطابقة لبحثك' : 'لا توجد منتجات في المتجر حالياً'}</p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3">{list.slice(0, more).map((p) => <Card key={p.id} p={p} />)}</ul>
            {list.length > more && (
              <button type="button" onClick={() => setMore(more + PAGE)} className="mt-8 min-h-13 w-full rounded-2xl bg-card font-bold ring-1 ring-line">عرض المزيد</button>
            )}
          </>
        )}
      </main>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4 safe-b">
          <Link to="/cart" className="rise mx-auto flex min-h-15 max-w-2xl items-center justify-between rounded-[22px] bg-ink px-6 text-white shadow-[var(--shadow-lift)] active:scale-[.99]">
            <span className="text-[16px] font-bold">عرض السلة <span className="font-light text-white/70">· {count} {count === 1 ? 'منتج' : 'منتجات'}</span></span>
            <span className="num text-[17px] font-extrabold">{iqd(subtotal)}</span>
          </Link>
        </div>
      )}
    </div>
  )
}
