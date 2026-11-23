import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Store, WifiOff } from 'lucide-react'
import { getProducts, getStore } from './lib/api'
import { logoUrl } from './lib/config'
import { reconcile, useCart } from './lib/cart'
import { slugOk, useLocation } from './lib/route'
import { ShopContext } from './lib/shop'
import { lineTotal } from './lib/qty'
import { Button, StateScreen } from './ui'
import Home from './pages/Home'
import Product from './pages/Product'
import Cart from './pages/Cart'
import Checkout from './pages/Checkout'
import Done from './pages/Done'

/** لون النص فوق لون المتجر: داكن لفاتح الألوان */
const inkFor = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1c1917' : '#ffffff'
}

const setMeta = (name, content) => document.querySelector(`meta[name="${name}"]`)?.setAttribute('content', content)

export default function App() {
  const { slug, path } = useLocation()
  const [data, setData] = useState({ status: 'loading' })         // loading | error | gone | ready
  const [notes, setNotes] = useState([])
  const [filter, setFilter] = useState({ q: '', cat: 0 })
  const cart = useCart(slug)
  const linesRef = useRef(cart.lines)
  linesRef.current = cart.lines

  /** يجلب المتجر والمنتجات ويوفّق السلة. quiet: بلا شاشة تحميل (يُرجع المنتجات الجديدة) */
  const load = useCallback(async (quiet = false) => {
    if (!slugOk(slug)) { setData({ status: 'gone' }); return null }
    if (!quiet) setData({ status: 'loading' })
    try {
      const store = await getStore(slug)
      if (!store) { setData({ status: 'gone' }); return null }
      const products = await getProducts(slug)
      const r = reconcile(linesRef.current, products)
      if (JSON.stringify(r.lines) !== JSON.stringify(linesRef.current)) cart.commit(r.lines)
      if (r.notes.length) setNotes(r.notes)
      setData({ status: 'ready', store, products })
      return { store, products, lines: r.lines }
    } catch {
      setData((d) => (quiet && d.status === 'ready' ? d : { status: 'error' }))
      return null
    }
  }, [slug, cart.commit])
  useEffect(() => { load() }, [load])

  const { store, products } = data
  const ctx = useMemo(() => {
    if (data.status !== 'ready') return null
    const byId = new Map(products.map((p) => [p.id, p]))
    const items = cart.lines.map((l) => ({ line: l, p: byId.get(l.id), units: l.units })).filter((i) => i.p)
    return {
      slug, store, products, byId, items, cart, refresh: () => load(true), filter, setFilter,
      notes, dismissNotes: () => setNotes([]),
      count: items.length, subtotal: items.reduce((t, i) => t + lineTotal(i.p, i.units), 0),
    }
  }, [data, slug, cart, filter, notes, load])

  // هوية الصفحة من المتجر وحده: لون، عنوان، أيقونة
  useEffect(() => {
    const ready = data.status === 'ready'
    const color = ready ? store.theme_color : '#059669'
    document.documentElement.style.setProperty('--brand', color)
    document.documentElement.style.setProperty('--on-brand', inkFor(color))
    document.title = ready ? store.name : 'متجر'
    setMeta('theme-color', ready ? color : '#ffffff')
    const icon = document.querySelector('link[rel="icon"]')
    if (icon) icon.href = (ready && logoUrl(store.logo_path)) || 'data:,'
  }, [data, store])

  if (data.status === 'loading') {
    return (
      <div className="mx-auto max-w-2xl bg-white p-4" aria-busy="true" aria-label="جارٍ التحميل">
        <div className="flex items-center gap-3"><div className="skeleton size-11 rounded-xl" /><div className="skeleton h-5 w-40 rounded-lg" /></div>
        <div className="skeleton mt-5 h-12 rounded-2xl" />
        <div className="mt-5 grid grid-cols-2 gap-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton aspect-[3/4] rounded-2xl" />)}</div>
      </div>
    )
  }
  if (data.status === 'error') {
    return <StateScreen icon={WifiOff} title="تعذّر الاتصال" text="تحقق من الإنترنت ثم أعد المحاولة." action={<Button onClick={() => load()}>إعادة المحاولة</Button>} />
  }
  if (data.status === 'gone') {
    // لا فرق بين متجر غير موجود وموقوف وقيد المراجعة: الخادم لا يكشف ذلك للزوار
    return <StateScreen icon={Store} title="هذا المتجر غير متاح" text="قد يكون الرابط غير صحيح أو أن المتجر متوقف مؤقتاً." />
  }

  const route = path.replace(/\/+$/, '') || '/'
  const pm = route.match(/^\/p\/([0-9a-f-]{36})$/i)
  return (
    <ShopContext.Provider value={ctx}>
      {pm ? <Product id={pm[1].toLowerCase()} />
        : route === '/cart' ? <Cart />
        : route === '/checkout' ? <Checkout />
        : route === '/done' ? <Done />
        : <Home />}
    </ShopContext.Provider>
  )
}
