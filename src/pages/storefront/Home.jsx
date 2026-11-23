import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ShoppingCart, Loader2, ChevronLeft, Search, Menu } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { lineTotal } from '../../lib/price'
import { formatIQD, formatNumber } from '../../lib/format'
import { useCart } from '../../context/CartContext'
import { STORE, asset } from '../../lib/store'
import AdCarousel from '../../components/AdCarousel'
import CategoryTile from '../../components/CategoryTile'
import ProductCard from '../../components/ProductCard'
import ContactCard, { FloatingWhatsapp } from '../../components/ContactCard'
import SideMenu from '../../components/SideMenu'

const TABS = [
  { k: 'new', t: 'وصل حديثاً' },
  { k: 'top', t: 'الأكثر طلباً' },
]
const TAB_INTERVAL = 8000

export default function Home() {
  const navigate = useNavigate()
  const cart = useCart()
  const mode = cart.mode ?? 'retail'

  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [popular, setPopular] = useState({})
  const [tab, setTab] = useState('new')
  const [autoTab, setAutoTab] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const menuBtn = useRef(null)

  useEffect(() => {
    Promise.all([
      supabase.from('storefront_products').select('*').order('created_at', { ascending: false }),
      supabase.from('categories').select('id, name').eq('store', 'rifai').order('sort_order'),
      supabase.from('popular_products').select('product_id, qty_sold'),
    ]).then(([p, c, pop]) => {
      if (p.error) setError('تعذّر تحميل المنتجات. تحقق من الاتصال بالإنترنت.')
      setProducts(p.data ?? [])
      setCategories(c.data ?? [])
      const map = {}
      ;(pop.data ?? []).forEach((r) => { map[r.product_id] = Number(r.qty_sold) })
      setPopular(map)
      setLoading(false)
    })
  }, [])

  // اللسانان يتبدّلان تلقائياً حتى يلمس المستخدم أحدهما
  useEffect(() => {
    if (!autoTab) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => {
      if (!document.hidden) setTab((k) => (k === 'new' ? 'top' : 'new'))
    }, TAB_INTERVAL)
    return () => clearInterval(t)
  }, [autoTab])

  const inStock = useMemo(() => products.filter((p) => p.in_stock), [products])

  const byCategory = useMemo(() => {
    const m = {}
    products.forEach((p) => { (m[p.category_id] ??= []).push(p) })
    return m
  }, [products])

  // الأحدث أولاً (العرض مرتَّب أصلاً بتاريخ الإضافة تنازلياً)
  const newest = useMemo(() => inStock.slice(0, 8), [inStock])

  // المميّز يدوياً يتصدّر، ثم الأكثر مبيعاً فعلياً، ثم الأحدث لملء الفراغ
  const top = useMemo(() => {
    const score = (p) => (p.is_featured ? 1e9 : 0) + (popular[p.id] ?? 0)
    return [...inStock].sort((a, b) => score(b) - score(a)).slice(0, 8)
  }, [inStock, popular])

  const shownList = tab === 'new' ? newest : top

  const switchMode = (m) => {
    if (m === mode) return
    // تبديل الوضع يفرّغ السلة لاختلاف الأسعار — نسأل قبل أن نُضيّع اختياره
    if (cart.count > 0 && !confirm('تبديل نوع الشراء سيفرغ سلّتك. تكمل؟')) return
    cart.setMode(m)
  }

  const subtotal = products.reduce((s, p) => {
    const qty = cart.items[p.id] ?? 0
    return s + lineTotal(p, mode, qty)
  }, 0)

  return (
    <div className="min-h-dvh pb-28">
      <SideMenu open={menu} onClose={() => setMenu(false)} returnFocusTo={menuBtn} />

      {/* ------------------------------- الرأس ------------------------------- */}
      <header className="surface-ink sticky top-0 z-30">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 pb-3 pt-4">
          <button
            ref={menuBtn} type="button" onClick={() => setMenu(true)}
            aria-label="فتح القائمة" aria-expanded={menu} aria-haspopup="dialog"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 transition hover:bg-white/20"
          >
            <Menu className="size-5" />
          </button>
          <img src={asset('logo-mark.png')} alt="" className="size-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-extrabold leading-tight">{STORE.name}</h1>
            <p className="truncate text-[11px] text-white/70">{STORE.addressShort}</p>
          </div>
          <Link
            to="/checkout"
            className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 transition hover:bg-white/20"
            aria-label={`السلة — ${cart.count} منتج`}
          >
            <ShoppingCart className="size-5" />
            {cart.count > 0 && (
              <span className="tnum absolute -top-1 -end-1 flex size-5 items-center justify-center rounded-full bg-brand-500 text-[10px] font-extrabold text-ink-900 ring-2 ring-ink-900">
                {formatNumber(cart.count)}
              </span>
            )}
          </Link>
        </div>

        {/* مبدّل نوع الشراء — قرار الزبون بلمسة، بلا شاشة تسبق البضاعة */}
        <div className="mx-auto max-w-3xl px-4 pb-4">
          <div role="group" aria-label="نوع الشراء" className="flex gap-1 rounded-xl bg-white/10 p-1">
            {[
              { v: 'retail', t: 'مفرد', s: 'بالقطعة' },
              { v: 'wholesale', t: 'جملة', s: 'بالدرزن' },
            ].map((m) => (
              <button
                key={m.v} type="button" onClick={() => switchMode(m.v)}
                aria-pressed={mode === m.v}
                className={`flex-1 rounded-lg py-2 text-sm font-extrabold transition ${
                  mode === m.v ? 'bg-white text-ink-900' : 'text-white/80 hover:bg-white/10'
                }`}
              >
                {m.t} <span className="text-[11px] font-bold opacity-70">· {m.s}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={`h-1 ${mode === 'wholesale' ? 'bg-amber-400' : 'bg-brand-500'}`} />
      </header>

      <main className="mx-auto max-w-3xl">
        {/* ----------------------------- الإعلانات ----------------------------- */}
        <div className="pt-4">
          <AdCarousel images={products.filter((p) => p.image_url).map((p) => p.image_url)} />
        </div>

        {error && (
          <p role="alert" className="surface mx-4 mt-4 border-s-4 border-danger-700 p-4 text-sm text-danger-700">
            {error}
          </p>
        )}

        {/* ------------------------------ الأصناف ------------------------------ */}
        <section aria-labelledby="cats-title" className="mt-8 px-4">
          <div className="mb-3 flex items-end justify-between">
            <h2 id="cats-title" className="text-xl font-extrabold tracking-tight">الأصناف</h2>
            <Link to="/retail" className="flex min-h-11 items-center gap-1 px-1 text-[13px] font-bold text-brand-800 hover:text-brand-900">
              كل المنتجات <ChevronLeft className="size-4" />
            </Link>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="size-7 animate-spin text-brand-700" /></div>
          ) : (
            <nav aria-label="تصفّح الأصناف" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {categories
                .filter((c) => (byCategory[c.id] ?? []).length > 0)
                .map((c, i) => (
                  <CategoryTile key={c.id} category={c} products={byCategory[c.id] ?? []} index={i} />
                ))}
            </nav>
          )}
        </section>

        {/* ---------------------- الجديدة / الأكثر طلباً ---------------------- */}
        <section aria-labelledby="picks-title" className="mt-8 px-4">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 id="picks-title" className="sr-only">مختارات المتجر</h2>
            <div role="tablist" aria-label="مختارات المتجر" className="flex gap-1 rounded-xl bg-ink-100 p-1">
              {TABS.map((t) => (
                <button
                  key={t.k} type="button" role="tab" aria-selected={tab === t.k}
                  onClick={() => { setAutoTab(false); setTab(t.k) }}
                  className={`rounded-lg px-3.5 py-2 text-[13px] font-extrabold transition ${
                    tab === t.k ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900'
                  }`}
                >
                  {t.t}
                </button>
              ))}
            </div>
            <Link to="/retail" className="flex min-h-11 shrink-0 items-center px-1 text-[13px] font-bold text-brand-800 hover:text-brand-900">
              عرض الكل
            </Link>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="size-7 animate-spin text-brand-700" /></div>
          ) : shownList.length === 0 ? (
            <p className="surface p-8 text-center text-sm text-ink-600">لا توجد منتجات متوفّرة الآن.</p>
          ) : (
            <div role="tabpanel" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {shownList.map((p, i) => (
                <ProductCard
                  key={p.id} product={p} mode={mode} index={i}
                  qty={cart.items[p.id] ?? 0}
                  onChange={(q) => cart.setQty(p.id, q)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ----------------------------- بحث سريع ----------------------------- */}
        <section className="mt-8 px-4">
          <Link
            to="/retail"
            className="surface flex items-center gap-3 p-4 text-ink-600 transition hover:bg-white"
          >
            <Search className="size-5 shrink-0 text-brand-800" />
            <span className="flex-1 text-sm font-bold">ابحث في {formatNumber(products.length)} منتج…</span>
            <ChevronLeft className="size-4" />
          </Link>
        </section>
      </main>

      <footer className="mx-auto mt-10 max-w-3xl px-4">
        <ContactCard />
        <p className="py-6 text-center text-xs text-ink-600">© {new Date().getFullYear()} {STORE.name}</p>
      </footer>

      {cart.count === 0 && <FloatingWhatsapp />}

      {cart.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 p-3">
          <button
            onClick={() => navigate('/checkout')}
            className="animate-rise mx-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-ink-900 p-3 text-white shadow-[0_12px_32px_-8px_rgb(30_42_56/0.45)] transition active:scale-[0.98]"
          >
            <span className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <ShoppingCart className="size-5" />
              <span className="tnum absolute -top-1 -end-1 flex size-5 items-center justify-center rounded-full bg-brand-500 text-[10px] font-extrabold text-ink-900 ring-2 ring-ink-900">
                {formatNumber(cart.count)}
              </span>
            </span>
            <span className="min-w-0 text-start">
              <span className="block text-[11px] text-white/75">{formatNumber(cart.units)} قطعة</span>
              <span className="tnum block text-[17px] font-extrabold tracking-tight">{formatIQD(subtotal)}</span>
            </span>
            <span className="ms-auto shrink-0 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold">إتمام الطلب</span>
          </button>
        </div>
      )}
    </div>
  )
}
