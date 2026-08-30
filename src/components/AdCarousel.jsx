import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, Pause, Play } from 'lucide-react'
import { ADS, AD_INTERVAL } from '../lib/ads'

/**
 * شريط الإعلانات — ثلاث شرائح تتقلّب تلقائياً.
 *
 * التمرير أصلي (scroll-snap) لا مكتبة: السحب بالإصبع يعمل كما يتوقّعه المستخدم،
 * وقارئ الشاشة يتنقّل بين الشرائح بلا حيل. التقليب يتوقّف عند أول لمس وعند
 * تفضيل «تقليل الحركة»، ولوحة المفاتيح تصل لكل شريحة عبر نقاط التنقّل.
 *
 * خلفية كل شريحة فسيفساء من صور بضاعتك الحقيقية، فوقها طبقة حبر معتمة تضمن
 * أن يبقى النص مقروءاً مهما كانت الصور فاتحة (التباين مقيس لا مقدَّر).
 */
export default function AdCarousel({ images = [] }) {
  const trackRef = useRef(null)
  const [active, setActive] = useState(0)
  const [playing, setPlaying] = useState(true)
  const reduced = useRef(false)

  useEffect(() => {
    reduced.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduced.current) setPlaying(false)
  }, [])

  // التقليب التلقائي — يتوقّف عند إخفاء التبويب توفيراً للبطارية
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      if (document.hidden) return
      const el = trackRef.current
      if (!el) return
      const next = (Math.round(Math.abs(el.scrollLeft) / el.clientWidth) + 1) % ADS.length
      goTo(next, true)
    }, AD_INTERVAL)
    return () => clearInterval(t)
  }, [playing])

  const goTo = (i, smooth = true) => {
    const el = trackRef.current
    if (!el) return
    // الاتجاه من اليمين لليسار: scrollLeft سالب في المتصفحات الحديثة
    const dir = getComputedStyle(el).direction === 'rtl' ? -1 : 1
    el.scrollTo({ left: dir * i * el.clientWidth, behavior: smooth && !reduced.current ? 'smooth' : 'auto' })
    setActive(i)
  }

  const onScroll = () => {
    const el = trackRef.current
    if (!el) return
    setActive(Math.round(Math.abs(el.scrollLeft) / el.clientWidth))
  }

  // أول تفاعل من المستخدم يوقف التقليب — لا نسحب الشريحة من تحت إصبعه
  const stop = () => setPlaying(false)

  return (
    <section
      aria-roledescription="carousel" aria-labelledby="ads-title"
      className="relative"
      onPointerDown={stop}
    >
      <h2 id="ads-title" className="sr-only">عروض المتجر</h2>
      <div
        ref={trackRef} onScroll={onScroll}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto scroll-smooth"
      >
        {ADS.map((ad, i) => (
          <AdSlide key={ad.id} ad={ad} index={i} total={ADS.length} images={images} />
        ))}
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        {ADS.map((ad, i) => (
          <button
            key={ad.id} type="button"
            onClick={() => { stop(); goTo(i) }}
            aria-label={`الإعلان ${i + 1}: ${ad.title}`}
            aria-current={active === i}
            className="grid size-6 place-items-center"
          >
            <span className={`block h-2.5 rounded-full transition-all ${
              active === i ? 'w-7 bg-ink-900' : 'w-2.5 bg-ink-200'
            }`} />
          </button>
        ))}
        <button
          type="button" onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'إيقاف التقليب التلقائي' : 'تشغيل التقليب التلقائي'}
          className="ms-1 flex size-8 items-center justify-center rounded-full text-ink-600 hover:bg-ink-100"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
      </div>
    </section>
  )
}

const TONE = {
  brand: 'from-brand-900 via-brand-800 to-ink-900',
  amber: 'from-[#7c3d09] via-[#8a4a12] to-ink-900',
  ink:   'from-ink-900 via-ink-800 to-brand-900',
}

function AdSlide({ ad, index, total, images }) {
  // تسع صور مختلفة لكل شريحة حتى لا تتكرّر الخلفيات
  const tiles = images.length
    ? Array.from({ length: 9 }, (_, k) => images[(index * 9 + k) % images.length])
    : []

  return (
    <article
      className="w-full shrink-0 snap-center px-4"
      aria-roledescription="slide" aria-label={`${index + 1} من ${total}`}
    >
      <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-bl ${TONE[ad.tone]}`}>
        {/* فسيفساء البضاعة — زخرفية، فلا تُعلن لقارئ الشاشة */}
        <div aria-hidden="true" className="absolute inset-0 grid grid-cols-3 opacity-20">
          {tiles.map((src, k) => (
            <img key={k} src={src} alt="" loading="lazy" className="size-full object-cover" />
          ))}
        </div>
        {/* أرضية معتمة مضمونة: حتى لو كانت صورة المنتج بيضاء بالكامل يبقى
            النص الأبيض فوق لون لا يفتح عن (40,51,65) — أي 13.5:1 */}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-bl from-ink-900/92 via-ink-900/80 to-ink-900/94" />

        <div className="relative flex min-h-56 flex-col justify-center p-5 text-white sm:min-h-64 sm:p-7">
          <p className="flex items-center gap-2 text-[12px] font-bold text-white/80">
            {ad.eyebrow}
            {ad.badge && (
              <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-extrabold text-ink-900">
                {ad.badge}
              </span>
            )}
          </p>

          <h3 className="mt-1.5 max-w-[16ch] text-[26px] font-extrabold leading-[1.15] tracking-tight sm:text-4xl">
            {ad.title}
          </h3>

          {ad.steps ? (
            <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px] font-bold text-white/90">
              {ad.steps.map((s, k) => (
                <li key={s} className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-white/15 text-[11px] font-extrabold">
                    {k + 1}
                  </span>
                  {s}
                  {k < ad.steps.length - 1 && <ChevronLeft className="size-4 text-white/40" />}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 max-w-[34ch] text-[13px] leading-relaxed text-white/85">{ad.body}</p>
          )}

          <Link
            to={ad.to}
            className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-extrabold text-ink-900 transition active:scale-95 hover:bg-white/90"
          >
            {ad.cta} <ChevronLeft className="size-4" />
          </Link>
        </div>
      </div>
    </article>
  )
}
