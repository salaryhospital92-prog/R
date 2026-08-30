import { Link } from 'react-router-dom'
import { Plus, Minus, ImageOff, AlertTriangle, Tag } from 'lucide-react'
import { formatIQD, formatNumber } from '../lib/format'
import { stepFor } from '../context/CartContext'

/**
 * بطاقة منتج في المعروض.
 * الترتيب البصري: الصورة ← السعر ← الاسم ← الفعل.
 * السعر قبل الاسم لأنه سؤال الزبون الأول في متجر مواد استهلاكية،
 * وكان سابقاً بنفس وزن الاسم فتساوى كل شيء ولم يبرز شيء.
 */
export default function ProductCard({ product, mode, qty, onChange, index = 0 }) {
  const step = stepFor(mode, product.sold_by)
  const byDozen = step === 12
  const price = mode === 'wholesale' ? product.price_wholesale : product.price_retail
  const onRequest = price === 0
  const soldOut = product.quantity_single <= 0
  const maxQty = Math.floor(product.quantity_single / step) * step
  const low = !soldOut && product.quantity_single <= step * 2

  return (
    <article
      className="animate-fade-up surface-raised group flex flex-col overflow-hidden transition duration-200 hover:-translate-y-0.5"
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      <Link
        to={`/p/${product.code}`}
        className="relative block aspect-square overflow-hidden bg-ink-50"
        aria-label={`تفاصيل ${product.name}`}
      >
        {product.image_url ? (
          <img
            src={product.image_url} alt={product.name} loading="lazy"
            className="size-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <span className="flex size-full items-center justify-center">
            <ImageOff className="size-8 text-ink-200" />
          </span>
        )}

        {soldOut && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/80 text-sm font-extrabold text-danger-700 backdrop-blur-[2px]">
            نفدت الكمية
          </span>
        )}
        {/* الحالة بلون + رمز + نص، لا بلون وحده */}
        {onRequest && !soldOut && (
          <span className="absolute top-2.5 start-2.5 flex items-center gap-1 rounded-full bg-warn-600 px-2 py-1 text-[11px] font-extrabold text-white">
            <Tag className="size-3" /> السعر عند الطلب
          </span>
        )}
        {low && !onRequest && !soldOut && (
          <span className="absolute top-2.5 start-2.5 flex items-center gap-1 rounded-full bg-alert-600 px-2 py-1 text-[11px] font-extrabold text-white">
            <AlertTriangle className="size-3" /> كمية محدودة
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-3.5">
        {/* السعر أولاً وبأكبر وزن — هو بؤرة البطاقة */}
        {onRequest ? (
          <p className="text-[15px] font-extrabold leading-none text-warn-600">عند الطلب</p>
        ) : (
          <p className="tnum text-[19px] font-extrabold leading-none tracking-tight text-brand-800">
            {formatIQD(price)}
          </p>
        )}
        {!onRequest && mode === 'wholesale' && (
          <p className="tnum mt-1 text-[11px] text-ink-600">
            {byDozen ? `الدرزن ${formatIQD(price * 12)}` : 'يُباع بالقطعة'}
          </p>
        )}

        <Link
          to={`/p/${product.code}`}
          className="mt-1 line-clamp-2 py-1 text-[13px] font-bold leading-snug text-ink-700 hover:text-brand-800"
        >
          {product.name}
        </Link>

        <div className="mt-auto pt-3">
          {soldOut ? (
            <span className="block rounded-xl bg-ink-50 py-2.5 text-center text-xs font-bold text-ink-600">
              غير متوفر
            </span>
          ) : qty === 0 ? (
            <button
              type="button"
              onClick={() => onChange(Math.min(step, maxQty))}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-700 py-2.5 text-sm font-bold text-white transition active:scale-95 hover:bg-brand-800"
            >
              <Plus className="size-4" /> إضافة
            </button>
          ) : (
            <div className="animate-pop flex items-center justify-between rounded-xl bg-brand-50 p-1 ring-1 ring-brand-700/20">
              <button
                type="button" onClick={() => onChange(Math.max(qty - step, 0))}
                className="flex size-9 items-center justify-center rounded-lg bg-white text-brand-800 ring-1 ring-ink-900/8 transition active:scale-90"
                aria-label={`إنقاص كمية ${product.name}`}
              >
                <Minus className="size-4" />
              </button>
              <span className="tnum text-[13px] font-extrabold text-brand-900">
                {byDozen ? `${formatNumber(qty / 12)} درزن` : `${formatNumber(qty)} قطعة`}
              </span>
              <button
                type="button" onClick={() => onChange(Math.min(qty + step, maxQty))} disabled={qty >= maxQty}
                className="flex size-9 items-center justify-center rounded-lg bg-white text-brand-800 ring-1 ring-ink-900/8 transition active:scale-90 disabled:opacity-40"
                aria-label={`زيادة كمية ${product.name}`}
              >
                <Plus className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
