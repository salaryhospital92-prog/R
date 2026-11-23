import { useMemo, useState } from 'react'
import { MessageCircle, Search, ShoppingBag, X } from 'lucide-react'
import { iqd, norm } from '../lib/format'
import { inStock, maxUnits, minNote, minUnits, priceNote, unitsText } from '../lib/qty'
import { useShop } from '../lib/shop'
import { Link, Logo, Notice, ProductImage, Stepper } from '../ui'

const PAGE = 40

function Card({ p }) {
  const { items, cart } = useShop()
  const line = items.find((i) => i.p.id === p.id)
  const ok = inStock(p)
  return (
    <li className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
      <Link to={`/p/${p.id}`} className="block" aria-label={p.name}>
        <ProductImage p={p} className={ok ? '' : 'opacity-50'} />
      </Link>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <Link to={`/p/${p.id}`} className="line-clamp-2 min-h-12 text-[15px] font-medium leading-6">{p.name}</Link>
        <p className="text-lg font-extrabold tabular-nums">{iqd(p.price)}</p>
        <p className="min-h-5 text-[13px] leading-5 text-stone-500">{priceNote(p)}{minNote(p) && ` · ${minNote(p)}`}</p>
        <div className="mt-auto pt-2">
          {!ok ? <span className="grid min-h-11 place-items-center rounded-xl bg-stone-100 text-[15px] font-bold text-stone-500">نفد</span>
            : line ? <Stepper value={line.units} min={minUnits(p)} max={maxUnits(p)} label={p.name}
                onChange={(u) => cart.setUnits(p, u)} onRemove={() => cart.remove(p.id)} />
            : <button type="button" onClick={() => cart.setUnits(p, minUnits(p))}
                className="min-h-11 w-full rounded-xl bg-brand-soft text-[15px] font-bold text-brand-deep transition active:scale-95">
                أضف للسلة{p.pack_qty ? ` · ${unitsText(p, minUnits(p))}` : ''}
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
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'ar'))
  }, [products])
  const list = useMemo(() => {
    const q = norm(filter.q).trim()
    return products.filter((p) => (!filter.cat || p.category_id === filter.cat) && (!q || norm(p.name).includes(q)))
  }, [products, filter])
  const set = (patch) => { setFilter({ ...filter, ...patch }); setMore(PAGE) }

  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-white pb-28">
      <header className="px-4 pt-4">
        <div className="flex items-center gap-3">
          <Logo store={store} />
          <h1 className="min-w-0 flex-1 truncate text-xl font-extrabold">{store.name}</h1>
          {store.whatsapp && (
            <a href={`https://wa.me/${store.whatsapp}`} target="_blank" rel="noopener noreferrer" aria-label="تواصل عبر واتساب"
              className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-deep"><MessageCircle className="size-5" /></a>
          )}
        </div>
        {store.about && (
          <button type="button" onClick={() => setAboutOpen(!aboutOpen)} className="mt-3 block w-full text-start text-[15px] leading-6 text-stone-600">
            <span className={aboutOpen ? '' : 'line-clamp-2'}>{store.about}</span>
          </button>
        )}
        {!store.open && <div className="mt-3"><Notice title="الطلب متوقف مؤقتاً">يمكنك تصفح المنتجات، وسنفتح الطلب قريباً.</Notice></div>}
        {notes.length > 0 && <div className="mt-3"><Notice title="تحديث على سلتك" onClose={dismissNotes}>{notes.map((n) => <p key={n}>{n}</p>)}</Notice></div>}
      </header>

      <div className="sticky top-0 z-20 mt-3 border-b border-stone-100 bg-white/95 px-4 pb-2 pt-2 backdrop-blur">
        <label className="relative block">
          <span className="sr-only">ابحث عن منتج</span>
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input type="search" value={filter.q} onChange={(e) => set({ q: e.target.value })} placeholder="ابحث عن منتج" enterKeyHint="search"
            className="h-12 w-full rounded-2xl bg-stone-100 pe-11 ps-11 outline-none placeholder:text-stone-400 focus:bg-white focus:ring-2 focus:ring-brand" />
          {filter.q && <button type="button" onClick={() => set({ q: '' })} aria-label="مسح البحث" className="absolute end-1 top-1/2 grid size-11 -translate-y-1/2 place-items-center text-stone-500"><X className="size-4" /></button>}
        </label>
        {cats.length > 1 && (
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label="الأصناف">
            {[[0, 'الكل'], ...cats].map(([id, name]) => (
              <button key={id} type="button" role="tab" aria-selected={filter.cat === id} onClick={() => set({ cat: id })}
                className={`min-h-11 shrink-0 rounded-full px-4 text-[15px] font-medium transition ${filter.cat === id ? 'bg-brand text-brand-ink' : 'bg-stone-100 text-stone-700'}`}>{name}</button>
            ))}
          </div>
        )}
      </div>

      <main className="px-4 pt-4">
        {list.length === 0 ? (
          <p className="py-16 text-center text-stone-500">{products.length ? 'لا نتائج مطابقة لبحثك' : 'لا توجد منتجات في المتجر حالياً'}</p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">{list.slice(0, more).map((p) => <Card key={p.id} p={p} />)}</ul>
            {list.length > more && (
              <button type="button" onClick={() => setMore(more + PAGE)} className="mt-5 min-h-12 w-full rounded-2xl bg-stone-100 font-bold">عرض المزيد</button>
            )}
          </>
        )}
      </main>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4 safe-b">
          <Link to="/cart" className="mx-auto flex min-h-14 max-w-2xl items-center gap-3 rounded-2xl bg-brand px-5 font-bold text-brand-ink shadow-lg shadow-black/20 active:scale-[.99]">
            <ShoppingBag className="size-5" aria-hidden="true" />
            <span className="flex-1">عرض السلة ({count})</span>
            <span className="tabular-nums">{iqd(subtotal)}</span>
          </Link>
        </div>
      )}
    </div>
  )
}
