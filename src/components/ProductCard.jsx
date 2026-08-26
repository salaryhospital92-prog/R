import { Plus, Minus, ImageOff } from 'lucide-react'
import { formatIQD, formatNumber } from '../lib/format'
import { stepFor } from '../context/CartContext'

export default function ProductCard({ product, mode, qty, onChange, index = 0 }) {
  const step = stepFor(mode)
  const price = mode === 'wholesale' ? product.price_wholesale : product.price_retail
  const onRequest = price === 0
  const soldOut = product.quantity_single <= 0
  const maxQty = Math.floor(product.quantity_single / step) * step

  const add = () => onChange(Math.min(qty + step, maxQty))
  const sub = () => onChange(Math.max(qty - step, 0))

  return (
    <article
      className="animate-fade-up flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="relative aspect-square bg-slate-100">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} loading="lazy"
               className="size-full object-cover transition duration-300 hover:scale-105" />
        ) : (
          <span className="flex size-full items-center justify-center"><ImageOff className="size-8 text-slate-300" /></span>
        )}
        {soldOut && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-bold text-red-600">
            نفدت الكمية
          </span>
        )}
        {onRequest && !soldOut && (
          <span className="absolute top-2 start-2 rounded-lg bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
            السعر عند الطلب
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-2 text-sm font-semibold">{product.name}</h3>

        <p className="mt-1 text-sm font-bold text-emerald-700">
          {onRequest ? 'يُحدَّد عند التأكيد' : formatIQD(price)}
          {!onRequest && mode === 'wholesale' && (
            <span className="block text-xs font-normal text-slate-500">
              للقطعة · الدرزن {formatIQD(price * 12)}
            </span>
          )}
        </p>

        <div className="mt-auto pt-3">
          {soldOut ? (
            <span className="block rounded-xl bg-slate-100 py-2 text-center text-sm text-slate-400">غير متوفر</span>
          ) : qty === 0 ? (
            <button
              onClick={add}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition active:scale-95"
            >
              <Plus className="size-4" /> إضافة
            </button>
          ) : (
            <div className="animate-pop flex items-center justify-between rounded-xl bg-emerald-50 p-1">
              <button onClick={sub} className="flex size-9 items-center justify-center rounded-lg bg-white text-emerald-700 active:scale-90" aria-label="إنقاص">
                <Minus className="size-4" />
              </button>
              <span className="text-sm font-bold text-emerald-800">
                {mode === 'wholesale'
                  ? `${formatNumber(qty / 12)} درزن`
                  : `${formatNumber(qty)} قطعة`}
              </span>
              <button
                onClick={add} disabled={qty >= maxQty}
                className="flex size-9 items-center justify-center rounded-lg bg-white text-emerald-700 active:scale-90 disabled:opacity-40"
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
