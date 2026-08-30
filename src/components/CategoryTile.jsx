import { Link } from 'react-router-dom'
import { formatNumber } from '../lib/format'

/**
 * بطاقة صنف مربّعة — صورتها فسيفساء 2×2 من منتجات الصنف نفسه.
 * لا أصول مرسومة: الزبون يرى بضاعتك قبل أن يدخل القسم.
 *
 * الاسم يجلس فوق الصور داخل تدرّج حبري معتم من الأسفل — أرضيته لا تفتح عن
 * ink-900/85 فوق أغمق ربع من الصورة، فيبقى النص الأبيض مقروءاً مهما كانت
 * الصور فاتحة (تُقاس أسوأ حالة تحليلياً كما في شرائح الإعلانات).
 */
export default function CategoryTile({ category, products, index = 0 }) {
  const tiles = products.filter((p) => p.image_url).slice(0, 4).map((p) => p.image_url)

  return (
    <Link
      to={`/retail?cat=${category.id}`}
      className="animate-fade-up surface-raised group relative block overflow-hidden transition hover:-translate-y-0.5"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <span aria-hidden="true" className="grid aspect-square grid-cols-2 grid-rows-2 gap-px bg-ink-100">
        {tiles.length
          ? tiles.map((src, k) => (
              <img key={k} src={src} alt="" loading="lazy"
                   className="size-full object-cover transition duration-500 group-hover:scale-105" />
            ))
          : <span className="col-span-2 row-span-2" />}
      </span>

      {/* ستارة معتمة تضمن قراءة الاسم فوق أي صورة */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink-900 via-ink-900/85 to-transparent"
      />

      <span className="absolute inset-x-0 bottom-0 p-2.5 text-white">
        <span className="block truncate text-[14px] font-extrabold leading-tight">{category.name}</span>
        <span className="tnum block text-[11px] text-white/85">{formatNumber(products.length)} منتج</span>
      </span>
    </Link>
  )
}
