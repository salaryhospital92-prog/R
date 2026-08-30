import { Link } from 'react-router-dom'
import { formatNumber } from '../lib/format'

/**
 * بطاقة صنف — أيقونتها فسيفساء 2×2 من صور منتجات الصنف نفسه.
 * لا أصول مرسومة: الزبون يرى بضاعتك الحقيقية قبل أن يدخل القسم.
 */
export default function CategoryTile({ category, products, index = 0 }) {
  const tiles = products.filter((p) => p.image_url).slice(0, 4).map((p) => p.image_url)

  return (
    <Link
      to={`/retail?cat=${category.id}`}
      className="animate-fade-up surface-raised group flex items-center gap-3 p-2.5 transition hover:-translate-y-0.5"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <span
        aria-hidden="true"
        className="grid size-16 shrink-0 grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-xl bg-ink-100"
      >
        {tiles.length
          ? tiles.map((src, k) => (
              <img key={k} src={src} alt="" loading="lazy"
                   className="size-full object-cover transition duration-500 group-hover:scale-105" />
            ))
          : <span className="col-span-2 row-span-2" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-extrabold text-ink-900">{category.name}</span>
        <span className="tnum block text-[12px] text-ink-600">{formatNumber(products.length)} منتج</span>
      </span>
    </Link>
  )
}
