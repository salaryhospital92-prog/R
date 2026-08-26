import { Plus, Minus, ImageOff } from 'lucide-react'
import { formatIQD, formatNumber } from '../lib/format'
import { stepFor } from '../context/CartContext'

export default function ProductCard({ product, mode, qty, onChange, index = 0 }) {
  const step = stepFor(mode)
  const price = mode === 'wholesale' ? product.price_wholesale : product.price_retail
  const onRequest = price === 0
  const soldOut = product.quantity_single <= 0
  const maxQty = Math.floor(product.quantity_single / step) * step
  const low = !soldOut && product.quantity_single <= step * 2

  return (
    <article
      className="animate-fade-up card group flex flex-col overflow-hidden shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-xl"
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      <div className="relative aspect-square overflow-hidden bg-slate-100">
        {product.image_url ? (
          <img
            src={product.image_url} alt={product.name} loading="lazy"
            className="size-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <span className="flex size-full items-center justify-center">
            <ImageOff className="size-8 text-slate-300" />
          </span>
        )}

        {soldOut && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/75 text-sm font-extrabold text-red-600 backdrop-blur-[2px]">
            نفدت الكمية
          </span>
        )}
        {onRequest && !soldOut && (
          <span className="absolute top-2.5 start-2.5 rounded-full bg-amber-500/95 px-2.5 py-1 text-[11px] font-extrabold text-white shadow-sm">
            السعر عند الطلب
          </span>
        )}
        {low && !onRequest && (
          <span className="absolute top-2.5 start-2.5 rounded-full bg-red-500/95 px-2.5 py-1 text-[11px] font-extrabold text-white shadow-sm">
            كمية محدودة
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3.5">
        <h3 className="line-clamp-2 text-[13px] font-bold leading-snug">{product.name}</h3>

        <div className="mt-1.5">
          {onRequest ? (
            <p className="text-sm font-extrabold text-amber-600">يُحدَّد عند التأكيد</p>
          ) : (
            <>
              <p className="text-base font-extrabold tracking-tight text-brand-700">{formatIQD(price)}</p>
              {mode === 'wholesale' && (
                <p className="text-[11px] text-slate-500">للقطعة · الدرزن {formatIQD(price * 12)}</p>
              )}
            </>
          )}
        </div>

        <div className="mt-auto pt-3">
          {soldOut ? (
            <span className="block rounded-2xl bg-slate-100 py-2.5 text-center text-xs font-bold text-slate-400">
              غير متوفر
            </span>
          ) : qty === 0 ? (
            <button
              onClick={() => onChange(Math.min(step, maxQty))}
              className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-brand-600 py-2.5 text-sm font-bold text-white shadow-sm shadow-brand-600/25 transition active:scale-95 hover:bg-brand-700"
            >
              <Plus className="size-4" /> إضافة
            </button>
          ) : (
            <div className="animate-pop flex items-center justify-between rounded-2xl bg-brand-50 p-1 ring-1 ring-brand-600/15">
              <button
                onClick={() => onChange(Math.max(qty - step, 0))}
                className="flex size-9 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm transition active:scale-90"
                aria-label="إنقاص"
              >
                <Minus className="size-4" />
              </button>
              <span className="text-[13px] font-extrabold text-brand-900">
                {mode === 'wholesale' ? `${formatNumber(qty / 12)} درزن` : `${formatNumber(qty)} قطعة`}
              </span>
              <button
                onClick={() => onChange(Math.min(qty + step, maxQty))} disabled={qty >= maxQty}
                className="flex size-9 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm transition active:scale-90 disabled:opacity-40"
                aria-label="زيادة"
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
