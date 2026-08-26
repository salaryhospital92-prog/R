import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, ShoppingCart, Loader2, PackageSearch, ChevronRight, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatIQD, formatNumber } from '../../lib/format'
import { useCart } from '../../context/CartContext'
import { STORE } from '../../lib/store'
import ProductCard from '../../components/ProductCard'
import ContactCard, { FloatingWhatsapp } from '../../components/ContactCard'

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
      const list = p.data ?? []
      setProducts(list)
      setCategories(c.data ?? [])
      setLoading(false)

      // تنظيف السلة من منتجات لم تعد موجودة (حُذفت أو أُوقفت) حتى لا يعلق
      // الزبون عند الدفع برسالة «منتج غير متوفر».
      if (list.length) {
        const live = new Set(list.map((x) => x.id))
        Object.keys(cart.items).forEach((id) => { if (!live.has(id)) cart.setQty(id, 0) })
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = products.filter((p) => {
    const q = query.trim()
    return (!q || p.name.includes(q)) && (!categoryId || String(p.category_id) === categoryId)
  })

  const subtotal = products.reduce((sum, p) => {
    const qty = cart.items[p.id] ?? 0
    return sum + qty * (mode === 'wholesale' ? p.price_wholesale : p.price_retail)
  }, 0)

  const isWholesale = mode === 'wholesale'
  const accent = isWholesale
    ? 'from-amber-500 to-orange-600'
    : 'from-brand-500 to-brand-700'

  return (
    <div className="min-h-dvh pb-28">
      <header className="sticky top-0 z-30">
        <div className={`bg-gradient-to-l ${accent} text-white`}>
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 pb-3 pt-4">
            <Link to="/" className="rounded-xl p-1.5 transition hover:bg-white/15" aria-label="رجوع">
              <ChevronRight className="size-5" />
            </Link>
            <img src="/icon-192.png" alt="" className="size-9 rounded-xl ring-2 ring-white/25" />
            <div className="min-w-0">
              <p className="font-extrabold leading-tight">{STORE.name}</p>
              <p className="text-[11px] text-white/85">
                {isWholesale ? 'أسعار الجملة — بالدرزن' : 'أسعار المفرد — بالقطعة'}
              </p>
            </div>
            <Link
              to={isWholesale ? '/retail' : '/wholesale'}
              className="ms-auto shrink-0 rounded-full bg-white/20 px-3 py-1.5 text-[11px] font-bold backdrop-blur-sm transition hover:bg-white/30"
            >
              {isWholesale ? 'تحويل للمفرد' : 'تحويل للجملة'}
            </Link>
          </div>

          <div className="mx-auto max-w-3xl px-4 pb-4">
            <div className="relative">
              <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-slate-400" />
              <input
                value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث عن منتج…"
                className="w-full rounded-2xl bg-white py-3 pe-10 ps-10 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400"
              />
              {query && (
                <button onClick={() => setQuery('')} className="absolute inset-y-0 end-3 my-auto text-slate-400" aria-label="مسح">
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="glass">
          <div className="no-scrollbar mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 py-2.5">
            {[{ id: '', name: 'الكل' }, ...categories].map((c) => (
              <button
                key={c.id || 'all'}
                onClick={() => setCategoryId(String(c.id))}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-bold transition ${
                  String(c.id) === categoryId
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-white text-slate-600 ring-1 ring-slate-900/5 hover:bg-slate-50'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-4">
        {error && <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-600/10">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-24"><Loader2 className="size-8 animate-spin text-brand-600" /></div>
        ) : shown.length === 0 ? (
          <div className="animate-fade-up card p-12 text-center text-slate-500">
            <PackageSearch className="mx-auto mb-3 size-10 text-slate-300" />
            لا توجد منتجات مطابقة.
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs font-semibold text-slate-400">{formatNumber(shown.length)} منتج</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {shown.map((p, i) => (
                <ProductCard
                  key={p.id} product={p} mode={mode} index={i}
                  qty={cart.items[p.id] ?? 0}
                  onChange={(q) => cart.setQty(p.id, q)}
                />
              ))}
            </div>
          </>
        )}

        <ContactCard className="mt-8" />
        <p className="mt-6 text-center text-xs text-slate-400">© {new Date().getFullYear()} {STORE.name}</p>
      </main>

      {cart.count === 0 && <FloatingWhatsapp />}

      {/* شريط السلة العائم — تحت الإبهام مباشرة على الجوال */}
      {cart.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 p-3">
          <button
            onClick={() => navigate('/checkout')}
            className="animate-rise mx-auto flex w-full max-w-md items-center gap-3 rounded-3xl bg-slate-900 p-3 text-white shadow-2xl shadow-slate-900/25 transition active:scale-[0.98]"
          >
            <span className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
              <ShoppingCart className="size-5" />
              <span className="absolute -top-1 -end-1 flex size-5 items-center justify-center rounded-full bg-brand-500 text-[10px] font-extrabold ring-2 ring-slate-900">
                {formatNumber(cart.count)}
              </span>
            </span>
            <span className="min-w-0 text-start">
              <span className="block text-[11px] text-white/60">
                {formatNumber(cart.units)} قطعة
              </span>
              <span className="block font-extrabold tracking-tight">{formatIQD(subtotal)}</span>
            </span>
            <span className="ms-auto shrink-0 rounded-2xl bg-brand-600 px-4 py-2.5 text-sm font-bold">
              إتمام الطلب
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
