import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ChevronRight, Loader2, ImageOff, Plus, Minus, ShoppingCart, MessageCircle,
  Share2, Check, PackageSearch, Truck,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatIQD, formatNumber } from '../../lib/format'
import { useCart, stepFor } from '../../context/CartContext'
import { STORE, contactWhatsappUrl } from '../../lib/store'
import ContactCard from '../../components/ContactCard'

/** صفحة منتج مستقلة — رابطها قصير ويُرسل مباشرة للزبون */
export default function ProductPage() {
  const { code } = useParams()
  const navigate = useNavigate()
  const cart = useCart()
  const [product, setProduct] = useState(null)
  const [mode, setMode] = useState(cart.mode ?? 'retail')
  const [qty, setQty] = useState(0)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    supabase.from('storefront_products').select('*').eq('code', code.toUpperCase()).maybeSingle()
      .then(({ data }) => {
        setProduct(data)
        setLoading(false)
        if (data) setQty(stepFor(cart.mode ?? 'retail', data.sold_by))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center"><Loader2 className="size-8 animate-spin text-brand-600" /></div>
  }

  if (!product) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <PackageSearch className="size-12 text-slate-300" />
        <p className="font-bold">هذا المنتج لم يعد متوفراً</p>
        <Link to="/" className="rounded-2xl bg-brand-600 px-5 py-2.5 font-bold text-white">تصفّح المتجر</Link>
      </main>
    )
  }

  const step = stepFor(mode, product.sold_by)
  const byDozen = step === 12
  const price = mode === 'wholesale' ? product.price_wholesale : product.price_retail
  const onRequest = price === 0
  const soldOut = product.quantity_single <= 0
  const maxQty = Math.floor(product.quantity_single / step) * step
  const safeQty = Math.min(Math.max(qty, step), Math.max(maxQty, step))

  const switchMode = (m) => {
    setMode(m)
    setQty(stepFor(m, product.sold_by))
  }

  // الطلب المباشر: سلة من هذا المنتج وحده ثم إلى إتمام الطلب
  const orderNow = () => {
    cart.setMode(mode)
    cart.clear()
    cart.setQty(product.id, safeQty)
    navigate('/checkout')
  }

  const addToCart = () => {
    cart.setMode(mode)
    cart.setQty(product.id, (cart.mode === mode ? (cart.items[product.id] ?? 0) : 0) + safeQty)
    navigate(mode === 'wholesale' ? '/wholesale' : '/retail')
  }

  const share = async () => {
    const url = window.location.href
    const text = `${product.name} — ${onRequest ? 'السعر عند الطلب' : formatIQD(price)}\n${STORE.name}\n${url}`
    if (navigator.share) {
      try { await navigator.share({ title: product.name, text, url }); return } catch { /* أُلغيت المشاركة */ }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* لا حافظة متاحة */ }
  }

  return (
    <div className="min-h-dvh pb-32">
      <header className="glass sticky top-0 z-30 flex items-center gap-2 p-3">
        <button onClick={() => navigate(-1)} className="rounded-xl p-1.5 hover:bg-slate-100" aria-label="رجوع">
          <ChevronRight className="size-5" />
        </button>
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}logo-mark.png`} alt="" className="size-8" />
          <span className="truncate font-extrabold">{STORE.name}</span>
        </Link>
        <button onClick={share} className="ms-auto flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold hover:bg-slate-200">
          {copied ? <Check className="size-4 text-brand-600" /> : <Share2 className="size-4" />}
          {copied ? 'نُسخ الرابط' : 'مشاركة'}
        </button>
      </header>

      <main className="mx-auto max-w-md px-4 pt-4">
        <div className="animate-fade-up card overflow-hidden">
          <div className="relative aspect-square bg-slate-100">
            {product.image_url ? (
              <img src={product.image_url} alt={product.name} className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center"><ImageOff className="size-10 text-slate-300" /></span>
            )}
            {soldOut && (
              <span className="absolute inset-0 flex items-center justify-center bg-white/75 text-lg font-extrabold text-red-600 backdrop-blur-[2px]">
                نفدت الكمية
              </span>
            )}
          </div>

          <div className="p-4">
            <p className="text-[11px] font-bold text-slate-400">{product.category}</p>
            <h1 className="mt-0.5 text-xl font-extrabold leading-snug">{product.name}</h1>

            <div className="mt-3 flex gap-2">
              {[{ v: 'retail', t: 'مفرد' }, { v: 'wholesale', t: 'جملة' }].map((m) => (
                <button
                  key={m.v} onClick={() => switchMode(m.v)}
                  className={`flex-1 rounded-xl py-2 text-sm font-bold transition ${
                    mode === m.v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {m.t}
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-2xl bg-brand-50 p-3 text-center ring-1 ring-brand-600/15">
              {onRequest ? (
                <p className="text-lg font-extrabold text-amber-600">السعر يُحدَّد عند التأكيد</p>
              ) : (
                <>
                  <p className="text-2xl font-extrabold text-brand-700">{formatIQD(price)}</p>
                  <p className="text-xs text-slate-500">
                    للقطعة {byDozen && `· الدرزن ${formatIQD(price * 12)}`}
                  </p>
                </>
              )}
            </div>

            <p className="mt-3 text-center text-xs text-slate-500">
              {soldOut ? 'غير متوفر حالياً'
                : `المتوفر: ${formatNumber(product.quantity_single)} قطعة` +
                  (product.sold_by === 'piece' ? ' · يُباع بالقطعة' : '')}
            </p>

            {!soldOut && (
              <div className="mt-3 flex items-center justify-between rounded-2xl bg-slate-100 p-1">
                <button onClick={() => setQty(Math.max(safeQty - step, step))}
                        className="flex size-11 items-center justify-center rounded-xl bg-white shadow-sm active:scale-90" aria-label="إنقاص">
                  <Minus className="size-5" />
                </button>
                <span className="font-extrabold">
                  {byDozen ? `${formatNumber(safeQty / 12)} درزن` : `${formatNumber(safeQty)} قطعة`}
                  {!onRequest && <span className="block text-xs font-normal text-slate-500">{formatIQD(price * safeQty)}</span>}
                </span>
                <button onClick={() => setQty(Math.min(safeQty + step, maxQty))} disabled={safeQty >= maxQty}
                        className="flex size-11 items-center justify-center rounded-xl bg-white shadow-sm active:scale-90 disabled:opacity-40" aria-label="زيادة">
                  <Plus className="size-5" />
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <Truck className="size-4" /> التوصيل لكل المحافظات — الأجرة حسب المنطقة
        </p>

        <a href={contactWhatsappUrl(`السلام عليكم، أستفسر عن: ${product.name}\n${window.location.href}`)}
           target="_blank" rel="noopener noreferrer"
           className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-bold text-slate-700 ring-1 ring-slate-900/5 hover:bg-slate-50">
          <MessageCircle className="size-4 text-brand-600" /> استفسر عن هذا المنتج
        </a>

        <ContactCard className="mt-6" />
        <p className="mt-6 text-center text-xs text-slate-400">© {new Date().getFullYear()} {STORE.name}</p>
      </main>

      {!soldOut && (
        <div className="glass fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md p-3">
          <div className="flex gap-2">
            <button onClick={addToCart}
                    className="flex items-center justify-center gap-1.5 rounded-2xl bg-slate-900 px-4 py-3.5 text-sm font-bold text-white active:scale-95">
              <ShoppingCart className="size-4" /> للسلة
            </button>
            <button onClick={orderNow}
                    className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 font-extrabold text-white active:scale-95">
              <MessageCircle className="size-5" /> اطلبه الآن
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
