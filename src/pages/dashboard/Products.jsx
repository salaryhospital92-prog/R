import { useCallback, useEffect, useState, lazy, Suspense } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, ScanLine, Search, Package, Loader2, ImageOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatIQD, formatNumber } from '../../lib/format'
import { hasText } from '../../lib/ocr'
import { useAuth } from '../../context/AuthContext'

// html5-qrcode مكتبة ثقيلة (~400KB) — تُحمَّل عند فتح الماسح فقط
const BarcodeScanner = lazy(() => import('../../components/BarcodeScanner'))

export default function Products() {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    // موظف الإدخال لا يطلب الأسعار إطلاقاً — والخادم لا يعطيه إياها أصلاً (RLS)
    const select = isAdmin
      ? 'id, barcode, name, description, image_url, quantity_single, category_id, sold_by, price_unit, categories(name), product_prices(price_retail, price_wholesale)'
      : 'id, barcode, name, description, image_url, quantity_single, category_id, sold_by, price_unit, categories(name)'

    const [p, c] = await Promise.all([
      supabase.from('products').select(select).order('created_at', { ascending: false }).limit(200),
      supabase.from('categories').select('id, name').order('sort_order'),
    ])
    if (p.error) setError('تعذّر تحميل المنتجات: ' + p.error.message)
    setProducts(p.data ?? [])
    setCategories(c.data ?? [])
    setLoading(false)
  }, [isAdmin])

  useEffect(() => { load() }, [load])

  // الباركود الممسوح: إن وُجد المنتج نفتحه لإضافة كمية، وإلا نفتح منتجاً جديداً بالباركود جاهزاً
  const handleScan = async (code) => {
    setScanning(false)
    const { data } = await supabase.from('products').select('id').eq('barcode', code).maybeSingle()
    navigate(data ? `/dashboard/product/${data.id}` : `/dashboard/product/new?barcode=${encodeURIComponent(code)}`)
  }

  const shown = products.filter((p) => {
    const q = query.trim()
    const matchQuery = !q || hasText(p.name, q) || hasText(p.barcode, q) || hasText(p.description, q)
    const matchCat = !categoryId || String(p.category_id) === categoryId
    return matchQuery && matchCat
  })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-extrabold">المنتجات</h1>
        <div className="ms-auto flex flex-1 gap-2 sm:flex-none">
          <button
            onClick={() => setScanning(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink-800 px-3 py-2 text-sm font-bold text-white hover:bg-ink-900 sm:flex-none"
          >
            <ScanLine className="size-4" /> مسح باركود
          </button>
          <Link
            to="/dashboard/product/new"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-700 px-3 py-2 text-sm font-bold text-white hover:bg-brand-800 sm:flex-none"
          >
            <Plus className="size-4" /> منتج جديد
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-ink-600" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالاسم أو الباركود…"
            className="w-full rounded-xl border border-ink-200 py-2 pe-3 ps-9 focus:border-brand-500 focus:outline-none"
          />
        </div>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-xl border border-ink-200 px-3 py-2 focus:border-brand-500 focus:outline-none"
        >
          <option value="">كل الأصناف</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-danger-700">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-7 animate-spin text-brand-700" /></div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center text-ink-600">
          <Package className="mx-auto mb-2 size-8 text-ink-200" />
          {products.length === 0 ? 'لا توجد منتجات بعد — ابدأ بإضافة منتج.' : 'لا نتائج مطابقة للبحث.'}
        </div>
      ) : (
        <ul className="grid gap-2">
          {shown.map((p) => (
            <li key={p.id}>
              <Link
                to={`/dashboard/product/${p.id}`}
                className="flex items-center gap-3 rounded-2xl bg-white p-3 hover:bg-ink-50"
              >
                {p.image_url ? (
                  <img src={p.image_url} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-ink-100">
                    <ImageOff className="size-5 text-ink-600" />
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="truncate text-xs text-ink-600">
                    {p.categories?.name}
                    {p.barcode && <span dir="ltr"> · {p.barcode}</span>}
                  </p>
                  {isAdmin && p.product_prices && (
                    <p className="mt-0.5 text-xs text-brand-700">
                      مفرد: {p.product_prices.price_retail > 0 ? formatIQD(p.product_prices.price_retail) : 'عند الطلب'}
                      {' · '}
                      جملة{' '}
                      <span className="rounded-full bg-ink-200 px-1.5 py-px text-[9px] font-extrabold text-ink-800">
                        {(p.price_unit ?? 'dozen') === 'dozen' ? 'درزن' : 'قطعة'}
                      </span>{' '}
                      {p.product_prices.price_wholesale > 0
                        ? formatIQD(p.product_prices.price_wholesale * ((p.price_unit ?? 'dozen') === 'dozen' ? 12 : 1))
                        : 'عند الطلب'}
                    </p>
                  )}
                </div>

                <span
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-sm font-bold ${
                    p.quantity_single > 0 ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-danger-700'
                  }`}
                >
                  {formatNumber(p.quantity_single)} قطعة
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {scanning && <Suspense fallback={null}><BarcodeScanner onScan={handleScan} onClose={() => setScanning(false)} /></Suspense>}
    </div>
  )
}
