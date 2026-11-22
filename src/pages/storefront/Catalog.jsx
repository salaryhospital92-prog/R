import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Search, ShoppingCart, Loader2, PackageSearch, ChevronRight, X, Menu } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatIQD, formatNumber } from '../../lib/format'
import { useCart } from '../../context/CartContext'
import { STORE, asset, contactWhatsappUrl, telUrl } from '../../lib/store'
import ProductCard from '../../components/ProductCard'
import ContactCard, { FloatingWhatsapp } from '../../components/ContactCard'
import SideMenu from '../../components/SideMenu'
import { hasText } from '../../lib/ocr'

export default function Catalog({ mode }) {
  const navigate = useNavigate()
  const cart = useCart()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  // الصنف والبحث يأتيان من الرابط ليكون كل عرض قابلاً للمشاركة
  const [params, setParams] = useSearchParams()
  const categoryId = params.get('cat') ?? ''
  const query = params.get('q') ?? ''

  const patch = (next) => setParams((prev) => {
    const p = new URLSearchParams(prev)
    Object.entries(next).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)))
    return p
  }, { replace: true })

  const setCategoryId = (v) => patch({ cat: v })
  const setQuery = (v) => patch({ q: v })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState(false)
  const menuBtn = useRef(null)

  // الرابط هو مصدر الحقيقة للوضع: /wholesale أو /retail
  useEffect(() => { cart.setMode(mode) }, [mode, cart])

  useEffect(() => {
    Promise.all([
      supabase.from('storefront_products').select('*').order('name'),
      supabase.from('categories').select('id, name').eq('store', 'rifai').order('sort_order'),
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
    return (!q || hasText(p.name, q) || hasText(p.description, q)) && (!categoryId || String(p.category_id) === categoryId)
  })

  const subtotal = products.reduce((sum, p) => {
    const qty = cart.items[p.id] ?? 0
    return sum + qty * (mode === 'wholesale' ? p.price_wholesale : p.price_retail)
  }, 0)

  const isWholesale = mode === 'wholesale'
  // وضع البيع يُميَّز بشريط لوني رفيع لا بصبغ الرأس كله — الأخضر محجوز للفعل
  const modeRule = isWholesale ? 'bg-amber-400' : 'bg-brand-500'

  return (
    <div className="min-h-dvh pb-28">
      <SideMenu open={menu} onClose={() => setMenu(false)} returnFocusTo={menuBtn} />

      <header className="sticky top-0 z-30">
        {/* شريط الحبر: توقيع النظام، ولونه مأخوذ من الشعار نفسه (#1E2A38) */}
        <div className="surface-ink">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 pb-3 pt-4">
            <Link to="/" className="flex size-10 shrink-0 items-center justify-center rounded-xl transition hover:bg-white/10" aria-label="رجوع للصفحة الأولى">
              <ChevronRight className="size-5" />
            </Link>
            <button
              ref={menuBtn} type="button" onClick={() => setMenu(true)}
              aria-label="فتح القائمة" aria-expanded={menu} aria-haspopup="dialog"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 transition hover:bg-white/20"
            >
              <Menu className="size-5" />
            </button>

            <img src={asset('logo-mark.png')} alt="" className="size-9" />
            <div className="min-w-0">
              <p className="text-[15px] font-extrabold leading-tight">{STORE.name}</p>
              <p className="text-[11px] text-white/70">{STORE.addressShort}</p>
            </div>
            <Link
              to={isWholesale ? '/retail' : '/wholesale'}
              className="ms-auto shrink-0 rounded-full bg-white/12 px-3 py-2 text-[12px] font-bold ring-1 ring-white/20 transition hover:bg-white/20"
            >
              {isWholesale ? 'تحويل للمفرد' : 'تحويل للجملة'}
            </Link>
          </div>

          <div className="mx-auto max-w-3xl px-4 pb-4">
            <label className="sr-only" htmlFor="product-search">ابحث عن منتج</label>
            <div className="relative">
              <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-ink-400" />
              <input
                id="product-search" type="search"
                value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث عن منتج…"
                className="w-full rounded-xl bg-white py-3 pe-10 ps-10 text-sm text-ink-900 outline-none placeholder:text-ink-400"
              />
              {query && (
                <button onClick={() => setQuery('')} className="absolute inset-y-0 end-2 my-auto rounded-lg p-1.5 text-ink-400 hover:text-ink-700" aria-label="مسح البحث">
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>

          {/* الشريط اللوني يفصل الحبر عن الرفّ ويحمل رمز وضع البيع */}
          <div className={`h-1 ${modeRule}`} />
        </div>

        <nav aria-label="أصناف المنتجات" className="glass">
          <div className="no-scrollbar mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 py-2.5">
            {[{ id: '', name: 'الكل' }, ...categories].map((c) => {
              const active = String(c.id) === categoryId
              return (
                <button
                  key={c.id || 'all'} type="button"
                  onClick={() => setCategoryId(String(c.id))}
                  aria-pressed={active}
                  className={`shrink-0 rounded-full px-3.5 py-2 text-[13px] font-bold transition ${
                    active
                      ? 'bg-ink-900 text-white'
                      : 'bg-white text-ink-600 ring-1 ring-ink-900/8 hover:bg-ink-50'
                  }`}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-5">
        {/* عنوان الصفحة: كان المعروض بلا h1 وبلا أي حجم فوق 16px */}
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold leading-tight tracking-tight">
              {isWholesale ? 'أسعار الجملة' : 'أسعار المفرد'}
            </h1>
            <p className="mt-0.5 text-[13px] text-ink-600">
              {isWholesale ? 'بالدرزن — أسعار أقل للكميات' : 'بالقطعة — للاستعمال الشخصي'}
            </p>
          </div>
          {!loading && shown.length > 0 && (
            <p className="tnum shrink-0 pb-1 text-[13px] font-bold text-ink-600">
              {formatNumber(shown.length)} منتج
            </p>
          )}
        </div>

        <div aria-live="polite" className="sr-only">
          {loading ? 'جارٍ تحميل المنتجات' : `${shown.length} منتج معروض`}
        </div>

        {error && (
          <p role="alert" className="surface mb-4 border-s-4 border-danger-700 p-4 text-sm text-danger-700">{error}</p>
        )}

        {loading ? (
          <div className="flex justify-center py-24"><Loader2 className="size-8 animate-spin text-brand-700" /></div>
        ) : products.length === 0 ? (
          // متجر بلا بضاعة بعد — رسالة مطمئنة بدل «لا نتائج» الجافة
          <div className="animate-fade-up surface-raised p-8 text-center">
            <img src={asset('logo-mark.png')} alt="" className="mx-auto mb-3 size-16" />
            <p className="text-lg font-extrabold">البضاعة تُضاف الآن</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-600">
              نجهّز المعروض ونصوّره منتجاً منتجاً. تواصل معنا وأخبرنا بما تريد
              ونوفّره لك حالاً.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <a href={contactWhatsappUrl()} target="_blank" rel="noopener noreferrer"
                 className="rounded-xl bg-brand-700 py-3 text-sm font-bold text-white hover:bg-brand-800">راسلنا واتساب</a>
              <a href={telUrl()} className="rounded-xl bg-ink-900 py-3 text-sm font-bold text-white hover:bg-ink-800">اتصل بنا</a>
            </div>
          </div>
        ) : shown.length === 0 ? (
          <div className="animate-fade-up surface p-12 text-center text-ink-600">
            <PackageSearch className="mx-auto mb-3 size-10 text-ink-200" />
            لا توجد منتجات مطابقة لبحثك.
            <button onClick={() => { setQuery(''); setCategoryId('') }}
                    className="mt-4 block w-full rounded-xl bg-ink-900 py-2.5 text-sm font-bold text-white sm:mx-auto sm:w-auto sm:px-6">
              إظهار كل المنتجات
            </button>
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

      <footer className="mx-auto mt-10 max-w-3xl px-4">
        <ContactCard />
        <p className="py-6 text-center text-xs text-ink-600">© {new Date().getFullYear()} {STORE.name}</p>
      </footer>

      {cart.count === 0 && <FloatingWhatsapp />}

      {/* شريط السلة العائم — تحت الإبهام مباشرة على الجوال */}
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
              <span className="block text-[11px] text-white/75">
                {formatNumber(cart.units)} قطعة
              </span>
              <span className="tnum block text-[17px] font-extrabold tracking-tight">{formatIQD(subtotal)}</span>
            </span>
            <span className="ms-auto shrink-0 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-bold">
              إتمام الطلب
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
