import { useEffect, useRef, useState } from 'react'
import { iqd, num } from '../lib/format'
import { Button } from '../ui'
import { rpc, sb } from './sb'
import { Wordmark } from './Panel'
import fiqhAudio from '../assets/fiqh-opinion.m4a'

// =====================================================================
// واجهة رزق قبل الدخول: قصة تتضح بالتمرير.
// المشاهد المثبّتة: غلاف طويل + محتوى sticky بارتفاع الشاشة، ومستمع تمرير واحد يحسب تقدّم كل مشهد (0..1).
// لا مكتبات ولا خطف للتمرير؛ الحركة transform/opacity فقط. مع «تقليل الحركة» تُعرض المشاهد كاملة بلا تثبيت.
// كل البيانات حقيقية: صور المنتجات (reseller_showcase) ومناطق التوصيل وأسعارها (delivery_zones).
// =====================================================================

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
/** العدد مع المعدود: 1 منتج، 2 منتجان، 3–10 منتجات، 11+ منتجاً */
const count = (n, [one, two, few, many]) => n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${num(n)} ${few}` : `${num(n)} ${many}`
const part = (p, k, n) => clamp(p * n - k)                 // تقدّم الجزء k من n
const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const SVH = typeof CSS !== 'undefined' && CSS.supports?.('height', '1svh') ? 'svh' : 'vh'

// ---------- محرك التمرير: مستمع واحد لكل المشاهد ----------
const scenes = new Set()
let raf = 0
let barP = -1
function tick() {
  raf = 0
  // القراءات أولاً ثم الكتابة (لا تخطيط قسري)؛ التقدّم على ارتفاع المحتوى المثبّت نفسه (100svh) لا innerHeight
  // الذي يتغيّر مع شريط عنوان iOS
  const de = document.documentElement
  const page = Math.round(clamp(scrollY / Math.max(1, de.scrollHeight - innerHeight)) * 1000) / 1000
  const next = [...scenes].map((s) => {
    const r = s.el.getBoundingClientRect()
    return Math.round(clamp(-r.top / Math.max(1, r.height - s.el.firstElementChild.offsetHeight)) * 500) / 500
  })
  if (page !== barP) { barP = page; const bar = document.querySelector('.page-bar'); if (bar) bar.style.transform = `scaleX(${page})` }
  ;[...scenes].forEach((s, i) => { if (next[i] !== s.p) { s.p = next[i]; s.set(next[i]) } })
}
const kick = () => { raf ||= requestAnimationFrame(tick) }
function useProgress(ref) {
  const [p, setP] = useState(still ? 1 : 0)
  useEffect(() => {
    if (still || !ref.current) return
    const s = { el: ref.current, set: setP, p: -1 }
    scenes.add(s)
    if (scenes.size === 1) { addEventListener('scroll', kick, { passive: true }); addEventListener('resize', kick) }
    kick()
    return () => {
      scenes.delete(s)
      if (!scenes.size) { removeEventListener('scroll', kick); removeEventListener('resize', kick) }
    }
  }, [ref])
  return p
}

/** مشهد مثبّت: len شاشات من التمرير. children(p, static) */
function Pinned({ len, className = '', label, children }) {
  const ref = useRef(null)
  const p = useProgress(ref)
  // إن كان المحتوى أطول من الشاشة (هاتف قصير أو خط مكبَّر) يُعرض المشهد كاملاً بلا تثبيت بدل أن يُقصّ
  const [fits, setFits] = useState(true)
  useEffect(() => {
    const col = ref.current?.firstElementChild?.firstElementChild
    if (still || !col || typeof ResizeObserver === 'undefined') return
    // المحتوى الفعلي فقط (لا الزخارف المطلقة ولا تكبير الشعار): أسفل آخر عنصر مقابل ارتفاع المشهد
    const flow = [...col.children].filter((k) => getComputedStyle(k).position !== 'absolute')
    const check = () => {
      const last = flow.at(-1)
      if (last && last.offsetTop + last.offsetHeight > col.clientHeight + 1) { setFits(false); ro.disconnect() }
    }
    const ro = new ResizeObserver(check)
    ro.observe(col); flow.forEach((k) => ro.observe(k))
    return () => ro.disconnect()
  }, [])
  if (still || !fits) return <section aria-label={label} className={className}>{children(1, true)}</section>
  return (
    <section ref={ref} aria-label={label} className={`relative ${className}`} style={{ height: `${len * 100}${SVH}` }}>
      <div className="pin sticky top-0 overflow-hidden">{children(p, false)}</div>
    </section>
  )
}

/** يظهر العنصر عند وصوله للشاشة (مرة واحدة) */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal')
    if (!('IntersectionObserver' in window)) return els.forEach((e) => e.classList.add('in'))
    const io = new IntersectionObserver((list) => list.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target) } }), { rootMargin: '0px 0px -8% 0px' })
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
}

/** مناطق التوصيل وأسعارها الحقيقية (نفس قائمة الطلب)، بترتيب عشوائي لا يتكرر فيه السعر مرتين متتاليتين */
function useZones() {
  const [zones, setZones] = useState([])
  useEffect(() => {
    sb.from('delivery_zones').select('name, fee').eq('is_active', true).not('zad_zone_id', 'is', null).gt('fee', 0)
      .then(({ data }) => {
        const pool = (data ?? []).filter((z) => !/زاد/.test(z.name)).sort(() => Math.random() - 0.5)
        const out = []
        while (pool.length) { const i = pool.findIndex((z) => z.fee !== out.at(-1)?.fee); out.push(pool.splice(i < 0 ? 0 : i, 1)[0]) }
        setZones(out)
      })
  }, [])
  return zones
}

const Strip = ({ items, reverse, speed, children }) => (
  <div dir="ltr" className="overflow-hidden" aria-hidden="true">
    <ul className={`marquee flex w-max [&>li]:mr-3 ${reverse ? 'marquee-rev' : ''}`} style={{ '--speed': speed }}>
      {[...items, ...items].map((x, i) => children(x, i))}
    </ul>
  </div>
)
const Img = ({ s, className = '' }) => s?.image_url
  ? <img src={s.image_url} alt="" decoding="async" referrerPolicy="no-referrer" className={`size-full object-cover ${className}`} />
  : <span className="skeleton block size-full" />

// =====================================================================
export default function Landing({ onStart }) {
  const [shots, setShots] = useState(null)   // null: قيد التحميل (يُحجز مكانها فلا تقفز الصفحة)
  const zones = useZones()
  useReveal()
  useEffect(() => { rpc('reseller_showcase').then((r) => setShots(r ?? [])).catch(() => setShots([])) }, [])
  const pics = shots ?? Array(12).fill(null), half = Math.ceil(pics.length / 2)

  return (
    <>
      {!still && <div className="page-bar fixed inset-x-0 top-0 z-50 h-[3px] bg-gold" aria-hidden="true" />}

      <Hero onStart={onStart} zones={zones} />
      {(shots === null || shots.length >= 4) && (
        <div className="space-y-3 pb-14 pt-2 [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
          {[[pics.slice(0, half), false, '52s'], [pics.slice(half), true, '60s']].map(([items, rev, sp], r) => (
            <Strip key={r} items={items} reverse={rev} speed={sp}>
              {(s, i) => <li key={i} className="size-28 shrink-0 overflow-hidden rounded-[22px] bg-card shadow-[var(--shadow-card)] ring-1 ring-line/70 sm:size-32"><Img s={s} /></li>}
            </Strip>
          ))}
        </div>
      )}

      <Story />
      <HowWeWork />
      <Walkthrough shots={shots ?? []} zones={zones} />
      <Journey zones={zones} />

      <div className="mx-auto max-w-md space-y-20 px-6 pb-4 pt-20">
        <section aria-labelledby="profit">
          <p className="reveal eyebrow !text-brand">كيف تربح؟</p>
          <h2 id="profit" className="reveal mb-6 mt-3 text-[28px] font-black leading-[40px] [text-wrap:balance]">أنت تحدّد ربحك على كل قطعة</h2>
          <ProfitExample zones={zones} />
        </section>
        <Halal />
        <Coverage zones={zones} />
        <section aria-labelledby="pay" className="reveal rounded-[28px] bg-card p-6 shadow-[var(--shadow-card)]">
          <p className="eyebrow !text-brand">أرباحك</p>
          <h2 id="pay" className="mt-3 text-[24px] font-black leading-9">تصلك إلى زين كاش أو كي كارد</h2>
          <p className="mt-3 text-[16px] font-light leading-8 text-ink-2">تضيف حسابك عند التسجيل. بعد تسليم كل طلب بأيام قليلة يصبح ربحه متاحاً، فتطلب تحويله بضغطة، أو نطلبه لك تلقائياً حين يبلغ رصيدك المتاح 25 ألف دينار. وتتابع كل دينار من «أرباحي».</p>
        </section>
      </div>
    </>
  )
}

// ---------- البداية: الشعار كبيراً في منتصف الشاشة، ثم يصغر ويصعد فوق العنوان مع التمرير ----------
function Hero({ onStart, zones }) {
  const logo = useRef(null)
  const [dy, setDy] = useState(0)          // المسافة من موضع الشعار النهائي إلى منتصف الشاشة
  useEffect(() => {
    if (still) return
    const f = () => { const el = logo.current; if (el) setDy(innerHeight / 2 - (el.offsetTop + el.offsetHeight / 2)) }
    f(); addEventListener('resize', f)
    return () => removeEventListener('resize', f)
  }, [])
  return (
    <Pinned len={1.9} label="رزق" className="isolate">
      {(p, st) => {
        const a = st ? 1 : clamp(p / 0.55), e = a * a * (3 - 2 * a)   // المرحلة الثانية بانسياب
        return (
          <div className={`relative mx-auto flex max-w-md flex-col items-center px-6 text-center ${st ? 'py-12' : 'h-full [justify-content:safe_center]'}`}>
            <span className="glow pointer-events-none absolute -top-24 right-[-30%] -z-10 size-[26rem] rounded-full bg-brand/14 blur-3xl" aria-hidden="true" />
            <span className="glow pointer-events-none absolute bottom-0 left-[-35%] -z-10 size-80 rounded-full bg-gold/20 blur-3xl [animation-delay:-4s]" aria-hidden="true" />
            <div ref={logo} className="relative" style={st ? undefined : { transform: `translateY(${(1 - e) * dy}px) scale(${1.85 - 0.85 * e})` }}>
              {!st && (
                <span className="pointer-events-none absolute inset-0" style={{ opacity: 1 - e }} aria-hidden="true">
                  {[0, 1].map((i) => <span key={i} className="halo absolute left-1/2 top-1/2 size-40 rounded-full border-2 border-brand/25" style={{ animationDelay: `${i * 1.6}s` }} />)}
                </span>
              )}
              <Wordmark size={88} className="mark-in relative" />
            </div>
            <div className="mt-7 w-full [@media(max-height:680px)]:mt-4" style={st ? undefined : { opacity: e, transform: `translateY(${(1 - e) * 36}px)`, pointerEvents: e > 0.6 ? 'auto' : 'none' }}>
              <p className="flex flex-wrap justify-center gap-2 text-[13px] font-bold">
                <span className="rounded-full bg-gold-soft px-3.5 py-1.5 text-[#7d5210]">مجاني بالكامل · بلا رأس مال</span>
                <button type="button" onClick={() => document.getElementById('halal')?.scrollIntoView({ block: 'center' })} className="rounded-full bg-brand-soft px-3.5 py-1.5 text-brand">متوافق مع الشريعة</button>
              </p>
              <h1 className="mt-4 text-[40px] font-black leading-[52px] tracking-tight [@media(max-height:680px)]:mt-3 [@media(max-height:680px)]:text-[32px] [@media(max-height:680px)]:leading-[42px]">رزقك يبدأ من <span className="text-brand">هاتفك</span></h1>
              <p className="mx-auto mt-3 max-w-[32ch] text-[16.5px] font-light leading-8 text-ink-2 [@media(max-height:680px)]:text-[15px] [@media(max-height:680px)]:leading-7">متجر إلكتروني باسمك، فيه بضاعة جاهزة. أنت تنشر وتبيع، ونحن نجهّز ونوصّل، والربح لك.</p>
              <div className="mt-6 [@media(max-height:680px)]:mt-4"><Button onClick={() => onStart('new')}>ابدأ متجرك مجاناً</Button></div>
              {/* ponytail: نص ثابت؛ احذفه حين يُفتح reseller_orders_enabled */}
              <p className="mt-3 text-[13px] font-bold text-brand">نفتح استقبال الطلبات قريباً إن شاء الله. جهّز متجرك من الآن.</p>
              {zones.length > 0 && <p className="mt-3 text-[13px] font-medium text-ink-2"><b className="num font-extrabold text-ink">{num(zones.length)}</b> منطقة توصيل، وأجرة كل منطقة معروفة مسبقاً</p>}
              <p className="mt-2 text-[15px] text-ink-2">لديك متجر؟ <button type="button" onClick={() => onStart('in')} className="min-h-11 font-bold text-ink underline decoration-line decoration-2 underline-offset-8">دخول</button></p>
            </div>
            {!st && <p className="absolute inset-x-0 bottom-[7svh] text-[12px] font-bold text-mute" style={{ opacity: 1 - clamp(p / 0.12) }} aria-hidden="true">مرّر لتبدأ <span className="nudge inline-block">↓</span></p>}
          </div>
        )
      }}
    </Pinned>
  )
}

// ---------- الحكاية: الكلمات تضيء مع التمرير ----------
const STORY = 'حولنا شبابٌ وشابات يملكون الوقت والطموح، ويبحثون عن عمل فلا يجدونه. كثيرٌ منهم يعرف كيف يبيع، لكنه لا يملك مالاً يغامر به في بضاعة قد لا تُباع. فسألنا أنفسنا: ماذا لو حملنا نحن المخاطرة، وتركنا لهم الفرصة؟'.split(' ')
function Story() {
  return (
    <Pinned len={2.6} label="الحكاية" className="bg-forest text-white">
      {(p, st) => {
        const lit = p * 1.35 * STORY.length, end = st ? 1 : part(p, 3, 4)
        return (
          <div className={`relative mx-auto flex max-w-md flex-col px-6 ${st ? 'py-20' : 'h-full [justify-content:safe_center]'}`}>
            <span className="pointer-events-none absolute -bottom-24 -left-24 size-72 rounded-full bg-gold/15 blur-3xl" aria-hidden="true" />
            <p className="eyebrow !text-gold">الحكاية</p>
            <p className="sr-only">{STORY.join(' ')}</p>
            <p className="story-text mt-5 font-bold" aria-hidden="true">
              {STORY.map((w, i) => <span key={i} style={{ opacity: st ? 1 : clamp(lit - i, 0.16, 1) }}>{w} </span>)}
            </p>
            <p className="mt-8 text-[17px] leading-8 text-white/80" style={{ opacity: end, transform: `translateY(${(1 - end) * 18}px)` }}>
              هكذا وُلد <b className="font-extrabold text-white">رزق</b>: فكرة مجانية بالكامل، بدأناها من <b className="font-extrabold text-gold">مدينة الرمادي</b>، وسنوسّعها إلى باقي المناطق إن شاء الله.
            </p>
          </div>
        )
      }}
    </Pinned>
  )
}

// ---------- كيف نعمل ----------
function HowWeWork() {
  return (
    <div className="mx-auto max-w-md px-6 pt-20">
      <section aria-labelledby="how">
        <p className="reveal eyebrow !text-brand">كيف نعمل؟</p>
        <h2 id="how" className="reveal mt-3 text-[30px] font-black leading-[42px] [text-wrap:balance]">البضاعة علينا، والربح لك</h2>
        <p className="reveal mt-5 text-[17px] font-light leading-8 text-ink-2">نحن مجموعة من التجار في بضائع مختلفة: عطور، وعناية، وأدوات حلاقة، ومستلزمات منزلية. خصّصنا جزءاً من بضاعتنا بسعر الجملة لأصحاب الصفحات. ولأن الظرف اليوم لا يحتمل التجارب، وفّرنا نحن البضاعة والتجهيز والتوصيل، ولكم الأرباح.</p>
        <div className="reveal mt-7 grid grid-cols-2 gap-3">
          {[['1', 'اختيار المنتجات', 'من بضاعتنا الجاهزة'], ['2', 'بدء النشر', 'على صفحاتك والمواقع']].map(([n, t, d]) => (
            <div key={t} className="rounded-[24px] bg-brand-soft p-5">
              <span className="grid size-10 place-items-center rounded-full bg-brand text-[17px] font-black text-white">{n}</span>
              <b className="mt-4 block text-[17px] font-extrabold leading-6">{t}</b>
              <span className="mt-1 block text-[14px] text-ink-2">{d}</span>
            </div>
          ))}
        </div>
        <p className="reveal mt-4 text-[15px] font-bold text-ink">هذا كل ما تحتاجه. والباقي علينا:</p>
        <p className="reveal mt-3 flex flex-wrap gap-2 text-[14px] font-bold text-ink-2">
          {['لا رأس مال', 'لا مخزن', 'لا توصيل', 'لا رسوم اشتراك'].map((x) => <span key={x} className="rounded-full bg-card px-3.5 py-1.5 ring-1 ring-line">{x}</span>)}
        </p>
      </section>
    </div>
  )
}

// ---------- الهاتف: خمس خطوات من الاختيار إلى الربح ----------
const STEPS = [
  ['اختر منتجاتك', 'بضاعة جاهزة ومجرّبة، تختار منها ما يناسب زبائنك.'],
  ['ضع ربحك', 'سعرنا ثابت، وأنت تضيف ربحك على كل قطعة.'],
  ['انشر رابط متجرك', 'متجر باسمك وشعارك، تشاركه على صفحاتك والمجموعات.'],
  ['يصلك الطلب', 'الزبون يطلب ويدفع عند الاستلام، ونحن نجهّز ونوصّل.'],
  ['ربحك في رصيدك', 'بعد التسليم بأيام قليلة يصبح ربحك متاحاً، فتطلب تحويله إلى زين كاش أو كي كارد.'],
]
const PW = 270, PH = 560
/** مقياس الهاتف من المساحة المتاحة له فعلاً داخل المشهد (ثابتة لأن المشهد بارتفاع 100svh) */
function usePhoneScale(ref) {
  const [k, setK] = useState(0.8)
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setK(clamp(Math.min((e.contentRect.height - 8) / PH, (e.contentRect.width - 8) / PW), 0.55, 1)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [ref])
  return k
}
const Phone = ({ k, children }) => (
  <div style={{ width: PW * k, height: PH * k }} aria-hidden="true" className="shrink-0">
    <div style={{ width: PW, height: PH, transform: `scale(${k})`, transformOrigin: 'top right' }}
      className="relative rounded-[46px] bg-ink p-[9px] shadow-[0_40px_70px_-28px_rgb(8_64_47/.55)] ring-1 ring-black/5">
      <div className="relative size-full overflow-hidden rounded-[38px] bg-paper">
        <span className="absolute left-1/2 top-2.5 z-20 h-[22px] w-[86px] -translate-x-1/2 rounded-full bg-ink" />
        {children}
      </div>
    </div>
  </div>
)

function Walkthrough({ shots, zones }) {
  const box = useRef(null)
  const k = usePhoneScale(box)
  const zone = zones.find((z) => z.fee >= 2000 && z.name.length <= 18) ?? zones[0] ?? null   // منطقة حقيقية فقط
  const screens = [S0, S1, S2, S3, S4]
  return (
    <Pinned len={5.5} label="كيف يعمل متجرك، خطوة بخطوة" className="mt-16">
      {(p, st) => {
        if (st) return (
          <div className="mx-auto max-w-md space-y-12 px-6 py-10">
            {STEPS.map(([t, d], i) => {
              const S = screens[i]
              return (
                <div key={t}>
                  <p className="num text-[13px] font-bold text-brand">{`0${i + 1}`} / 05</p>
                  <h3 className="mt-1 text-[22px] font-black">{t}</h3><p className="mt-1 text-[15px] text-ink-2">{d}</p>
                  <div className="mt-5 flex justify-center"><Phone k={0.8}><S t={1} shots={shots} zone={zone} /></Phone></div>
                </div>
              )
            })}
          </div>
        )
        const n = STEPS.length, i = Math.min(n - 1, Math.floor(clamp(p * 1.04) * n)), t = part(clamp(p * 1.04), i, n)
        return (
          <div className="mx-auto flex h-full max-w-md flex-col px-6 pt-[max(1.25rem,4svh)]">
            <ol className="sr-only">{STEPS.map(([a, b]) => <li key={a}>{a}: {b}</li>)}</ol>
            <div aria-hidden="true">
              <div className="flex gap-1.5">
                {STEPS.map((_, j) => (
                  <span key={j} className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10">
                    <span className="block h-full origin-right rounded-full bg-brand" style={{ transform: `scaleX(${j < i ? 1 : j === i ? t : 0})` }} />
                  </span>
                ))}
              </div>
              <div key={i} className="rise mt-4 min-h-[112px]">
                <p className="num text-[13px] font-bold text-brand">{`0${i + 1}`} / 05</p>
                <h3 className="mt-0.5 text-[24px] font-black leading-8">{STEPS[i][0]}</h3>
                <p className="mt-0.5 text-[15px] leading-6 text-ink-2">{STEPS[i][1]}</p>
              </div>
            </div>
            <div ref={box} className="relative mt-3 flex min-h-0 flex-1 justify-center pb-4">
              <span className="pointer-events-none absolute top-10 size-64 rounded-full bg-brand/10 blur-3xl" aria-hidden="true" />
              <Phone k={k}>
                {screens.map((S, j) => (
                  <div key={j} className="absolute inset-0 transition duration-500 ease-out"
                    style={{ opacity: j === i ? 1 : 0, transform: `translateY(${j < i ? -14 : j > i ? 14 : 0}px)` }}>
                    <S t={j === i ? t : j < i ? 1 : 0} shots={shots} zone={zone} />
                  </div>
                ))}
              </Phone>
            </div>
          </div>
        )
      }}
    </Pinned>
  )
}

const Screen = ({ title, sub, children }) => (
  <div className="flex h-full flex-col px-4 pb-4 pt-11">
    <p className="text-[16px] font-black">{title}</p>
    {sub && <p className="text-[11px] text-mute">{sub}</p>}
    {children}
  </div>
)

// 1) اختيار المنتجات: علامات الاختيار تظهر واحدة تلو الأخرى
function S0({ t, shots }) {
  const on = Math.min(6, Math.floor(t * 7.5))
  return (
    <Screen title="منتجات جاهزة" sub="اختر ما يناسب زبائنك">
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {Array.from({ length: 6 }, (_, j) => (
          <div key={j} className={`relative aspect-square overflow-hidden rounded-2xl bg-card ring-2 transition duration-300 ${j < on ? 'ring-brand' : 'ring-line'}`}>
            <Img s={shots[j]} />
            <span className={`absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-brand text-[12px] font-black text-white transition duration-300 ${j < on ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}>✓</span>
          </div>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between rounded-2xl bg-ink px-4 py-3 text-white">
        <span className="text-[12px] text-white/70">اخترت</span><b className="num text-[15px]">{on ? count(on, ['منتج واحد', 'منتجان', 'منتجات', 'منتجاً']) : 'لا شيء بعد'}</b>
      </div>
    </Screen>
  )
}

// 2) الربح: يزيد مع التمرير، ومعه سعر متجرك
function S1({ t, shots }) {
  const profit = Math.round((t * 2500) / 250) * 250
  return (
    <Screen title="ضع ربحك" sub="على كل قطعة">
      <div className="mt-3 overflow-hidden rounded-2xl bg-card ring-1 ring-line">
        <div className="aspect-[4/3]"><Img s={shots[0]} /></div>
        <p className="flex items-center justify-between px-3 pt-2.5 text-[12.5px] font-bold">منتج من بضاعتنا <span className="rounded-md bg-gold-soft px-1.5 py-0.5 text-[10px] text-[#7d5210]">مثال</span></p>
        <div className="space-y-1.5 px-3 py-3 text-[12.5px]">
          <p className="flex justify-between"><span className="text-mute">سعرنا</span><b className="num">{iqd(10000)}</b></p>
          <p className="flex justify-between"><span className="text-mute">ربحك</span><b className="num text-brand">+ {iqd(profit)}</b></p>
        </div>
      </div>
      <div className="mt-4 h-2 rounded-full bg-wash"><div className="h-full rounded-full bg-gold" style={{ width: `${t * 100}%` }} /></div>
      <div className="mt-auto rounded-2xl bg-brand px-4 py-3 text-white">
        <p className="text-[11px] text-white/70">سعر متجرك</p>
        <p className="num text-[22px] font-black">{iqd(10000 + profit)}</p>
      </div>
    </Screen>
  )
}

// 3) المتجر باسمك، ونافذة المشاركة تصعد
function S2({ t, shots }) {
  const up = clamp(t * 1.6 - 0.25)
  return (
    <div className="relative h-full">
      <div className="px-4 pt-11">
        <div className="flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-2xl bg-[#7a3e9d] text-[17px] font-black text-white">ن</span>
          <span><b className="block text-[15px] font-black">متجر نور</b><span className="text-[11px] text-mute">عطور وعناية · الدفع عند الاستلام</span></span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((j) => (
            <div key={j} className="overflow-hidden rounded-xl bg-card ring-1 ring-line">
              <div className="aspect-square"><Img s={shots[j]} /></div>
              <p className="num px-2 py-1.5 text-[11px] font-bold">{iqd(12500 + j * 1500)}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 rounded-t-[26px] bg-card px-4 pb-5 pt-3 shadow-[0_-12px_30px_-10px_rgb(23_22_26/.25)]"
        style={{ transform: `translateY(${(1 - up) * 105}%)` }}>
        <span className="mx-auto block h-1 w-10 rounded-full bg-line" />
        <p className="mt-3 text-[14px] font-black">شارك رابط متجرك</p>
        <div className="mt-2 flex items-center justify-between rounded-xl bg-wash px-3 py-2.5 text-[12px]"><span className="font-bold text-ink-2">رابط متجرك جاهز</span><span className="rounded-lg bg-ink px-2.5 py-1 font-bold text-white">نسخ</span></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] font-bold">
          {[['فيسبوك', '#1877f2'], ['إنستغرام', '#d62976'], ['تيك توك', '#111111'], ['واتساب', '#1fa855']].map(([n, c], j) => (
            <span key={n} className="rounded-xl py-2.5 text-center text-white transition duration-300" style={{ background: c, opacity: up > 0.4 + j * 0.12 ? 1 : 0.25 }}>{n}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// 4) طلب جديد يصل، وحالته تتقدّم حتى التسليم
function S3({ t, shots, zone }) {
  const drop = clamp(t * 4), stage = t < 0.4 ? 0 : t < 0.7 ? 1 : 2
  const where = zone ? `توصيل ${zone.name}` : 'توصيل حسب منطقة الزبون'
  const total = 2 * 12500 + (zone?.fee ?? 0)
  return (
    <div className="relative h-full px-4 pt-11">
      <div className="rounded-2xl bg-ink p-3 text-white shadow-[var(--shadow-lift)]" style={{ opacity: drop, transform: `translateY(${(1 - drop) * -30}px)` }}>
        <p className="flex justify-between text-[11px] text-white/60"><span>متجر نور</span><span>الآن</span></p>
        <p className="mt-1 text-[14px] font-black">طلب جديد</p>
        <p className="mt-0.5 line-clamp-1 text-[12px] text-white/80">قطعتان · {where}</p>
      </div>
      <div className="mt-3 rounded-2xl bg-card p-3 ring-1 ring-line">
        <div className="flex items-center gap-2.5">
          <span className="size-12 shrink-0 overflow-hidden rounded-xl"><Img s={shots[2]} /></span>
          <span className="min-w-0 flex-1"><b className="line-clamp-1 text-[12.5px]">منتج من بضاعتنا</b><span className="num text-[12px] text-mute">2 × {iqd(12500)} · مثال</span></span>
        </div>
        <div className="mt-3 space-y-1.5 border-t pt-2.5 text-[12px]">
          {zone && <p className="flex justify-between gap-2"><span className="line-clamp-1 text-mute">{where}</span><b className="num shrink-0">{iqd(zone.fee)}</b></p>}
          <p className="flex justify-between"><span className="text-mute">يدفعه الزبون عند الاستلام</span><b className="num">{iqd(total)}{zone ? '' : ' + التوصيل'}</b></p>
        </div>
      </div>
      <ol className="mt-4 flex items-center gap-1.5 text-[11px] font-bold">
        {['نجهّزه', 'في الطريق', 'تم التسليم'].map((s, j) => (
          <li key={s} className={`flex-1 rounded-full py-2 text-center transition duration-300 ${j <= stage ? 'bg-brand text-white' : 'bg-wash text-mute'}`}>{s}</li>
        ))}
      </ol>
      <Route u={clamp((t - 0.35) / 0.5)} />
    </div>
  )
}

// مسار التوصيل: نقطة تتحرك من المخزن إلى الزبون
function Route({ u }) {
  const P = [[204, 22], [110, 96], [22, 62]]
  const at = (i) => (1 - u) ** 2 * P[0][i] + 2 * (1 - u) * u * P[1][i] + u ** 2 * P[2][i]
  const d = `M${P[0]} Q${P[1]} ${P[2]}`
  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl bg-[#eaf0ea] ring-1 ring-line">
      <svg viewBox="0 0 226 92" className="block w-full">
        <defs><pattern id="g" width="14" height="14" patternUnits="userSpaceOnUse"><path d="M14 0H0V14" fill="none" stroke="#d5ded5" strokeWidth="1" /></pattern></defs>
        <rect width="226" height="92" fill="url(#g)" />
        <path d={d} fill="none" stroke="#b9c7bb" strokeWidth="3" strokeDasharray="2 6" strokeLinecap="round" />
        <path d={d} fill="none" stroke="var(--color-brand)" strokeWidth="3" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - u} />
        <circle cx={P[0][0]} cy={P[0][1]} r="6" fill="var(--color-ink)" />
        <circle cx={P[2][0]} cy={P[2][1]} r="6" fill="none" stroke="var(--color-brand)" strokeWidth="2.5" />
        <circle cx={at(0)} cy={at(1)} r="7.5" fill="var(--color-gold)" stroke="white" strokeWidth="2.5" />
      </svg>
      <span className="absolute right-2.5 top-8 text-[10px] font-bold text-ink-2">المخزن</span>
      <span className="absolute bottom-1.5 left-2.5 text-[10px] font-bold text-brand">الزبون</span>
    </div>
  )
}

// 5) الربح يدخل الرصيد، ثم طلب التحويل
function S4({ t }) {
  const ready = t > 0.4, bal = ready ? Math.round((clamp((t - 0.4) * 4) * 5000) / 100) * 100 : 0, sent = t > 0.8
  return (
    <Screen title="أرباحي">
      <div className="mt-3 rounded-[22px] bg-forest p-4 text-white">
        <p className="text-[11px] text-white/60">رصيدك المتاح</p>
        <p className="num text-[30px] font-black text-gold">{iqd(bal)}</p>
        <p className="mt-1 text-[11px] text-white/60">{ready ? `قطعتان × ربح ${iqd(2500)}` : 'يصبح الربح متاحاً بعد أيام قليلة من التسليم'}</p>
      </div>
      <div className="mt-3 space-y-2 text-[12px]">
        <p className="flex items-center justify-between rounded-xl bg-card px-3 py-2.5 ring-1 ring-line">
          <span>طلب متجر نور · تم التسليم</span>
          <b className={`num rounded-md px-1.5 py-0.5 transition ${ready ? 'text-ok' : 'bg-gold-soft text-[#7d5210]'}`}>{ready ? `+ ${iqd(5000)}` : 'قيد الانتظار'}</b>
        </p>
      </div>
      <p className="mt-4 text-[12px] font-bold text-ink-2">التحويل إلى</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[12px] font-bold">
        {['زين كاش', 'كي كارد'].map((m, j) => <span key={m} className={`rounded-xl py-2.5 text-center ring-1 transition ${j === 0 && sent ? 'bg-brand-soft text-brand ring-brand' : 'bg-card ring-line'}`}>{m}</span>)}
      </div>
      <div className={`mt-auto rounded-2xl py-3 text-center text-[13px] font-black transition duration-300 ${sent ? 'bg-ok text-white' : 'bg-ink text-white'}`}>{sent ? 'أُرسل طلب التحويل' : 'اطلب التحويل'}</div>
    </Screen>
  )
}

// ---------- ما يحدث بعد الطلب: خط يمتدّ عبر أربع محطات ----------
function Journey({ zones }) {
  const flow = [
    ['الزبون يطلب من متجرك', 'يختار من رابطك ويطلب، والدفع عند الاستلام.'],
    ['نجهّز الطلب', 'نجمع القطع ونغلّفها ونتحقق منها قبل الخروج.'],
    ['نوصّله إلى بابه', zones.length ? `إلى ${num(zones.length)} منطقة، والأجرة على الزبون حسب منطقته.` : 'إلى باب الزبون، وأجرة التوصيل عليه.'],
    ['ربحك في رصيدك', 'بعد التسليم بأيام قليلة يصبح متاحاً، ويُحوَّل إلى زين كاش أو كي كارد.'],
  ]
  return (
    <Pinned len={3.2} label="ما يحدث بعد أن يطلب زبونك" className="mt-10 bg-ink text-white">
      {(p, st) => {
        const q = st ? 1 : clamp(p * 1.15)
        return (
          <div className={`relative mx-auto flex max-w-md flex-col px-6 ${st ? 'py-20' : 'h-full [justify-content:safe_center]'}`}>
            <span className="pointer-events-none absolute right-[-40%] top-[-10%] size-96 rounded-full bg-brand/30 blur-3xl" aria-hidden="true" />
            <p className="eyebrow !text-gold">بعد أن يطلب زبونك</p>
            <h2 className="mt-2 text-[30px] font-black leading-[42px]">نحن نكمل الباقي</h2>
            <div className="relative mt-6">
              <span className="absolute bottom-3 right-[11px] top-3 w-0.5 rounded bg-white/12" aria-hidden="true" />
              <span className="absolute right-[11px] top-3 w-0.5 origin-top rounded bg-gold" style={{ height: `calc((100% - 24px) * ${q})` }} aria-hidden="true" />
              <ol className="space-y-3">
                {flow.map(([a, b], j) => {
                  const on = clamp(q * 4 - j + 0.15)
                  return (
                    <li key={a} className="relative flex gap-4" style={{ opacity: 0.25 + on * 0.75 }}>
                      <span className={`relative z-10 mt-1 grid size-6 shrink-0 place-items-center rounded-full ring-4 ring-ink transition duration-300 ${on >= 1 ? 'bg-gold' : 'bg-white/20'}`}>
                        <span className="num text-[11px] font-black text-ink">{j + 1}</span>
                      </span>
                      <div className="min-w-0 flex-1 rounded-2xl bg-white/[.06] px-4 py-3.5 ring-1 ring-white/10" style={{ transform: `translateX(${(1 - on) * -14}px)` }}>
                        <b className="block text-[17px] font-extrabold">{a}</b>
                        <span className="mt-0.5 block text-[14px] leading-6 text-white/70">{b}</span>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          </div>
        )
      }}
    </Pinned>
  )
}

// ---------- مثال الربح ----------
function ProfitExample({ zones }) {
  const [n, setN] = useState(4)
  const [k, setK] = useState(0)
  const base = 10000, profit = 2500
  const zone = zones.length ? zones[k % zones.length] : null
  useEffect(() => {
    if (zones.length < 2 || still) return
    const t = setInterval(() => setK((x) => x + 1), 2600)
    return () => clearInterval(t)
  }, [zones.length])
  return (
    <div className="reveal relative overflow-hidden rounded-[28px] bg-forest p-6 text-white shadow-[var(--shadow-lift)]">
      <span className="glow pointer-events-none absolute -top-16 -left-16 size-48 rounded-full bg-gold/25 blur-3xl" aria-hidden="true" />
      <p className="text-[13px] font-bold text-white/60">مثال حسابي</p>
      <ol className="relative mt-4 space-y-3 text-[16px]">
        <li className="flex items-baseline justify-between gap-3"><span className="text-white/75">سعر المنتج عندنا</span><b className="num">{iqd(base)}</b></li>
        <li className="flex items-baseline justify-between gap-3"><span className="text-white/75">تضيف ربحك</span><b className="num text-gold">+ {iqd(profit)}</b></li>
        {zone && (
          <li key={k} className="rise flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-white/75">توصيل <b className="font-bold text-white">{zone.name}</b></span>
            <b className="num shrink-0">+ {iqd(zone.fee)}</b>
          </li>
        )}
        <li className="flex items-baseline justify-between gap-3 border-t border-white/15 pt-3"><span className="text-white/75">يدفعه الزبون عند الاستلام</span><b className="num">{iqd(base + profit + (zone?.fee ?? 0))}</b></li>
      </ol>
      {zone && <p className="relative mt-3 text-[13px] leading-6 text-white/60">أجرة التوصيل يدفعها الزبون حسب منطقته، ولا تُنقص شيئاً من ربحك.</p>}
      <div className="relative mt-6 rounded-2xl bg-white/8 p-4 ring-1 ring-white/10">
        <label htmlFor="pcs" className="flex items-baseline justify-between text-[15px]"><span>لو بعت يومياً</span><b className="num text-[18px]">{count(n, ['قطعة واحدة', 'قطعتان', 'قطع', 'قطعة'])}</b></label>
        <input id="pcs" type="range" min="1" max="20" value={n} onChange={(e) => setN(+e.target.value)} className="mt-3 w-full accent-[var(--color-gold)]" />
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div><p className="text-[12px] text-white/60">ربحك في اليوم</p><p className="num text-[22px] font-black">{iqd(n * profit)}</p></div>
          <div><p className="text-[12px] text-white/60">في الشهر تقريباً</p><p className="num text-[22px] font-black text-gold">{iqd(n * profit * 30)}</p></div>
        </div>
      </div>
      <p className="relative mt-4 text-[12.5px] leading-6 text-white/55">مثال للتوضيح فقط. ربحك الفعلي يحدّده ما تبيعه والربح الذي تضعه أنت.</p>
    </div>
  )
}

// ---------- متوافق مع الشريعة: الرأي الفقهي بصوته ----------
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
function Halal() {
  const ref = useRef(null)
  const [on, setOn] = useState(false)
  const [at, setAt] = useState(0)
  const [len, setLen] = useState(32)
  const toggle = () => { const a = ref.current; if (a.paused) a.play().catch(() => setOn(false)); else a.pause() }
  return (
    <section id="halal" aria-labelledby="halal-h" className="reveal scroll-mt-6 rounded-[28px] bg-brand-soft p-6">
      <p className="eyebrow !text-brand">متوافق مع الشريعة الإسلامية</p>
      <h2 id="halal-h" className="mt-3 text-[26px] font-black leading-9">ربحٌ حلال، بطريقة واضحة</h2>
      <p className="mt-3 text-[16px] font-light leading-8 text-ink-2">نحرص أن تكون كل معاملة في رزق متوافقة مع أحكام الشريعة الإسلامية، ونعتمد في طريقة عملنا على رأي فقهي يجيزها. استمع إليه بنفسك:</p>
      <audio ref={ref} src={fiqhAudio} preload="metadata" onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={() => { setOn(false); setAt(0) }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)} onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLen(e.currentTarget.duration)} />
      <div className="mt-5 flex items-center gap-4 rounded-2xl bg-card p-3 pe-4 shadow-[var(--shadow-card)]">
        <button type="button" onClick={toggle} aria-pressed={on}
          className="min-h-12 shrink-0 rounded-xl bg-brand px-5 text-[15px] font-bold text-white transition active:scale-[.97]">{on ? 'إيقاف' : 'استمع'}</button>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold">الرأي الفقهي الذي نعتمده</p>
          <div className="mt-2 flex items-center gap-2.5">
            <input type="range" min="0" max={len} step="0.1" value={at} aria-label="موضع التشغيل" dir="ltr"
              onChange={(e) => { ref.current.currentTime = +e.target.value; setAt(+e.target.value) }}
              className="h-1 min-w-0 flex-1 accent-[var(--color-brand)]" />
            <span className="num shrink-0 text-[12px] font-medium text-mute" dir="ltr">{mmss(on || at ? at : len)}</span>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- التغطية: من الرمادي، بمناطق وأسعار حقيقية ----------
function Coverage({ zones }) {
  const half = Math.ceil(Math.min(zones.length, 28) / 2)
  return (
    <section aria-labelledby="cover" className="reveal">
      <p className="eyebrow !text-brand">أين نوصّل؟</p>
      <h2 id="cover" className="mt-3 text-[30px] font-black leading-[42px]">بدأنا من <span className="text-brand">الرمادي</span></h2>
      <p className="mt-3 text-[16px] font-light leading-8 text-ink-2">
        {zones.length ? <>مناطق التوصيل: <b className="num font-extrabold text-ink">{num(zones.length)}</b> منطقة، وأجرة كل منطقة معروفة قبل الطلب. </> : null}
        وسنتوسّع إلى باقي المناطق إن شاء الله.
      </p>
      {zones.length > 3 && (
        <div className="-mx-6 mt-6 space-y-2.5 [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]">
          {[[zones.slice(0, half), false, '58s'], [zones.slice(half, half * 2), true, '64s']].map(([items, rev, sp], r) => (
            <Strip key={r} items={items} reverse={rev} speed={sp}>
              {(z, i) => <li key={i} dir="rtl" className="shrink-0 whitespace-nowrap rounded-full bg-card px-4 py-2 text-[13px] font-medium ring-1 ring-line">{z.name} <b className="num text-brand">{iqd(z.fee)}</b></li>}
            </Strip>
          ))}
        </div>
      )}
    </section>
  )
}
