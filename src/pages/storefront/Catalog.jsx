import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, ShoppingCart, Loader2, PackageSearch, ArrowRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatIQD, formatNumber } from '../../lib/format'
import { useCart } from '../../context/CartContext'
import ProductCard from '../../components/ProductCard'

export default function Catalog({ mode }) {
  const navigate = useNavigate()
  const cart = useCart()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [categoryId, setCategoryId] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // الرابط هو مصدر الحقيقة للوضع: /wholesale أو /retail
  useEffect(() => { cart.setMode(mode) }, [mode, cart])

  useEffect(() => {
    Promise.all([
      supabase.from('storefront_products').select('*').order('name'),
      supabase.from('categories').select('id, name').order('sort_order'),
    ]).then(([p, c]) => {
      if (p.error) setError('تعذّر تحميل المنتجات. تحقق من الاتصال بالإنترنت.')
      setProducts(p.data ?? [])
      setCategories(c.data ?? [])
      setLoading(false)
    })
  }, [])

  const shown = products.filter((p) => {
    const q = query.trim()
    return (!q || p.name.includes(q)) && (!categoryId || String(p.category_id) === categoryId)
  })

  const subtotal = products.reduce((sum, p) => {
    const qty = cart.items[p.id] ?? 0
    const price = mode === 'wholesale' ? p.price_wholesale : p.price_retail
    return sum + qty * price
  }, 0)

  const isWholesale = mode === 'wholesale'

  return (
    <div className="min-h-dvh pb-24">
      <header className={`sticky top-0 z-20 ${isWholesale ? 'bg-amber-600' : 'bg-emerald-600'} text-white`}>
        <div className="mx-auto flex max-w-3xl items-center gap-2 p-3">
          <Link to="/" className="rounded-lg p-1.5 hover:bg-white/15" aria-label="رجوع">
            <ArrowRight className="size-5" />
          </Link>
          <div className="min-w-0">
            <p className="font-bold leading-tight">أسواق الرفاعي</p>
            <p className="text-xs text-white/80">{isWholesale ? 'أسعار الجملة — بالدرزن' : 'أسعار المفرد — بالقطعة'}</p>
          </div>
        </div>

        <div className="mx-auto max-w-3xl px-3 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-slate-400" />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن منتج…"
              className="w-full rounded-xl py-2.5 pe-3 ps-9 text-slate-900 outline-none"
            />
          </div>
        </div>

        <div className="mx-auto flex max-w-3xl gap-2 overflow-x-auto px-3 pb-3">
          {[{ id: '', name: 'الكل' }, ...categories].map((c) => (
            <button
              key={c.id || 'all'}
              onClick={() => setCategoryId(String(c.id))}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                String(c.id) === categoryId ? 'bg-white text-slate-900' : 'bg-white/15 text-white'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-3">
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="size-8 animate-spin text-emerald-600" /></div>
        ) : shown.length === 0 ? (
          <div className="animate-fade-up rounded-2xl bg-white p-10 text-center text-slate-500">
            <PackageSearch className="mx-auto mb-2 size-9 text-slate-300" />
            لا توجد منتجات مطابقة.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shown.map((p, i) => (
              <ProductCard
                key={p.id} product={p} mode={mode} index={i}
                qty={cart.items[p.id] ?? 0}
                onChange={(q) => cart.setQty(p.id, q)}
              />
            ))}
          </div>
        )}
      </main>

      {/* شريط السلة السفلي — الإبهام يصله بسهولة على الجوال */}
      {cart.count > 0 && (
        <button
          onClick={() => navigate('/checkout')}
          className="animate-fade-up fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-3xl items-center gap-3 bg-slate-900 p-4 text-white"
        >
          <span className="relative">
            <ShoppingCart className="size-6" />
            <span className="absolute -top-1.5 -end-1.5 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold">
              {formatNumber(cart.count)}
            </span>
          </span>
          <span className="text-start">
            <span className="block text-xs text-white/70">
              {isWholesale ? `${formatNumber(cart.units / 12)} درزن` : `${formatNumber(cart.units)} قطعة`}
            </span>
            <span className="block font-bold">{formatIQD(subtotal)}</span>
          </span>
          <span className="ms-auto rounded-xl bg-emerald-600 px-4 py-2 font-semibold">إتمام الطلب</span>
        </button>
      )}
    </div>
  )
}
