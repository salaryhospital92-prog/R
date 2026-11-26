import { useEffect, useRef, useState } from 'react'
import { errText } from '../lib/config'
import { iqd, num, phoneOf } from '../lib/format'
import { Button, Field, Notice, field } from '../ui'
import { rpc, sb } from './sb'
import { Wordmark } from './Panel'

// المحاولة الجارية تُحفظ في الجلسة: فتح تيليغرام قد يعيد تحميل الصفحة، فتستأنفها بدل أن تبدأ جديدة ويضيع تأكيدك
const KEY = 'razq-login'
const saved = () => { try { const v = JSON.parse(sessionStorage.getItem(KEY)); return v && Date.now() - v.at < 170000 ? v : null } catch { return null } }
const keep = (v) => { try { v ? sessionStorage.setItem(KEY, JSON.stringify(v)) : sessionStorage.removeItem(KEY) } catch { /* وضع خاص */ } }
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('')
/** البريد التركيبي لحساب الهاتف (كما ينشئه reseller_phone_register) */
const phoneEmail = (local) => `ph964${local.slice(1)}@phone.invalid`

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

const Strip = ({ items, reverse, speed }) => (
  <div dir="ltr" className="overflow-hidden" aria-hidden="true">
    <ul className={`marquee flex w-max gap-3 ${reverse ? 'marquee-rev' : ''}`} style={{ '--speed': speed }}>
      {[...items, ...items].map((p, i) => (
        <li key={i} className="size-28 shrink-0 overflow-hidden rounded-[22px] bg-card shadow-[var(--shadow-card)] ring-1 ring-line/70 sm:size-32">
          <img src={p.image_url} alt="" loading={i < 8 ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" className="size-full object-cover" />
        </li>
      ))}
    </ul>
  </div>
)

const STEPS = [
  ['اختر منتجاتك', 'من تطبيقك تختار ما يناسب زبائنك من بضاعة جاهزة ومجرّبة، وتحدّد ربحك على كل قطعة.'],
  ['انشرها على صفحاتك', 'تشارك رابط متجرك على فيسبوك وإنستغرام وتيك توك والمجموعات. متجرك باسمك وشعارك.'],
  ['نحن نكمل الباقي', 'الزبون يطلب من متجرك، فنجهّز الطلب ونوصله ونستلم المبلغ، ويدخل ربحك في رصيدك.'],
]

function ProfitExample() {
  const [n, setN] = useState(4)
  const base = 10000, profit = 2500
  return (
    <div className="reveal relative overflow-hidden rounded-[28px] bg-forest p-6 text-white shadow-[var(--shadow-lift)]">
      <span className="glow pointer-events-none absolute -top-16 -left-16 size-48 rounded-full bg-gold/25 blur-3xl" aria-hidden="true" />
      <p className="text-[13px] font-bold text-white/60">مثال حسابي</p>
      <ol className="relative mt-4 space-y-3 text-[16px]">
        <li className="flex items-baseline justify-between gap-3"><span className="text-white/75">سعر المنتج عندنا</span><b className="num">{iqd(base)}</b></li>
        <li className="flex items-baseline justify-between gap-3"><span className="text-white/75">تضيف ربحك</span><b className="num text-gold">+ {iqd(profit)}</b></li>
        <li className="flex items-baseline justify-between gap-3 border-t border-white/15 pt-3"><span className="text-white/75">يدفعه الزبون عند الاستلام</span><b className="num">{iqd(base + profit)}</b></li>
      </ol>
      <div className="relative mt-6 rounded-2xl bg-white/8 p-4 ring-1 ring-white/10">
        <label htmlFor="pcs" className="flex items-baseline justify-between text-[15px]"><span>لو بعت يومياً</span><b className="num text-[18px]">{num(n)} {n === 1 ? 'قطعة' : n <= 10 ? 'قطع' : 'قطعة'}</b></label>
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

export default function Login() {
  const [shots, setShots] = useState([])
  const [entry, setEntry] = useState(() => (saved() ? 'telegram' : null))   // null | new | in | telegram
  useReveal()
  useEffect(() => { rpc('reseller_showcase').then((r) => setShots(r ?? [])).catch(() => {}) }, [])
  const start = (how) => { setEntry(how); requestAnimationFrame(() => document.getElementById('start')?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }
  const half = Math.ceil(shots.length / 2)

  return (
    <div className="overflow-x-clip">
      {/* البداية */}
      <section className="relative isolate pb-10 pt-8">
        <span className="glow pointer-events-none absolute -top-24 right-[-30%] -z-10 size-[26rem] rounded-full bg-brand/14 blur-3xl" aria-hidden="true" />
        <span className="glow pointer-events-none absolute top-40 left-[-35%] -z-10 size-80 rounded-full bg-gold/20 blur-3xl [animation-delay:-4s]" aria-hidden="true" />
        <div className="mx-auto max-w-md px-6">
          <div className="flex items-start justify-between">
            <Wordmark size={96} className="mark-in" />
            <button type="button" onClick={() => start('in')} className="min-h-11 rounded-2xl bg-card/70 px-4 text-[14px] font-bold text-ink-2 ring-1 ring-line backdrop-blur hover:bg-card">دخول</button>
          </div>
          <p className="reveal mt-7 inline-flex rounded-full bg-gold-soft px-3.5 py-1.5 text-[13px] font-bold text-[#7d5210]">مجاني بالكامل · بلا رأس مال</p>
          <h1 className="reveal mt-4 text-[40px] font-black leading-[52px] tracking-tight [text-wrap:balance]" style={{ '--d': '80ms' }}>رزقك يبدأ<br />من <span className="text-brand">هاتفك</span></h1>
          <p className="reveal mt-4 max-w-[34ch] text-[17px] font-light leading-8 text-ink-2" style={{ '--d': '160ms' }}>متجر إلكتروني باسمك، فيه بضاعة جاهزة. أنت تنشر وتبيع، ونحن نجهّز ونوصّل، والربح لك.</p>
          <div className="reveal mt-7" style={{ '--d': '240ms' }}>
            <Button onClick={() => start('new')}>ابدأ متجرك مجاناً</Button>
          </div>
        </div>
        {shots.length >= 4 && (
          <div className="mt-11 space-y-3 [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
            <Strip items={shots.slice(0, half)} speed="52s" />
            <Strip items={shots.slice(half)} reverse speed="60s" />
          </div>
        )}
      </section>

      <div className="mx-auto max-w-md space-y-20 px-6 pb-16 pt-6">
        {/* الحكاية */}
        <section aria-labelledby="story">
          <p className="reveal eyebrow !text-brand">الحكاية</p>
          <h2 id="story" className="reveal mt-3 text-[28px] font-black leading-[40px] [text-wrap:balance]">بدأنا لأننا رأينا الهمّة بلا فرصة</h2>
          <div className="mt-5 space-y-4 text-[17px] font-light leading-8 text-ink-2">
            <p className="reveal">حولنا شبابٌ وشابات يملكون الوقت والطموح، ويبحثون عن عمل فلا يجدونه. وكثيرٌ منهم يعرف كيف يبيع، لكنه لا يملك مالاً يغامر به في بضاعة قد لا تُباع.</p>
            <p className="reveal">فسألنا أنفسنا: ماذا لو حملنا نحن المخاطرة، وتركنا لهم الفرصة؟</p>
            <p className="reveal">هكذا وُلد <b className="font-extrabold text-ink">رزق</b>: فكرة مجانية بالكامل، بدأناها من <b className="font-extrabold text-ink">مدينة الرمادي</b>، وسنوسّعها إلى باقي المناطق إن شاء الله.</p>
          </div>
          <blockquote className="reveal mt-7 border-s-4 border-gold ps-5 text-[20px] font-bold leading-9 text-ink">بابُ رزقٍ صغير، نفتحه لكل من يريد أن يبدأ.</blockquote>
        </section>

        {/* كيف نعمل */}
        <section aria-labelledby="how">
          <p className="reveal eyebrow !text-brand">كيف نعمل؟</p>
          <h2 id="how" className="reveal mt-3 text-[28px] font-black leading-[40px] [text-wrap:balance]">البضاعة علينا، والربح لك</h2>
          <p className="reveal mt-5 text-[17px] font-light leading-8 text-ink-2">نحن مجموعة من التجار في بضائع مختلفة: عطور، وعناية، وأدوات حلاقة، ومستلزمات منزلية. خصّصنا جزءاً من بضاعتنا بسعر الجملة لأصحاب الصفحات. ولأن الظرف اليوم لا يحتمل التجارب، وفّرنا نحن البضاعة والتجهيز والتوصيل، ولكم الأرباح.</p>
          <ol className="mt-8 space-y-4">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="reveal flex gap-4 rounded-[24px] bg-card p-5 shadow-[var(--shadow-card)]" style={{ '--d': `${i * 90}ms` }}>
                <span className="num text-[34px] font-black leading-none text-brand/30">{`0${i + 1}`}</span>
                <span><b className="block text-[17px] font-extrabold">{t}</b><span className="mt-1 block text-[15px] leading-7 text-ink-2">{d}</span></span>
              </li>
            ))}
          </ol>
        </section>

        {/* ما تحتاجه */}
        <section aria-labelledby="need">
          <p className="reveal eyebrow !text-brand">ما الذي تحتاجه؟</p>
          <h2 id="need" className="reveal mt-3 text-[28px] font-black leading-[40px]">خطوتان فقط</h2>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {[['1', 'اختيار المنتجات', 'من بضاعتنا الجاهزة'], ['2', 'بدء النشر', 'على صفحاتك والمواقع']].map(([n, t, d], i) => (
              <div key={t} className="reveal rounded-[24px] bg-brand-soft p-5" style={{ '--d': `${i * 90}ms` }}>
                <span className="grid size-10 place-items-center rounded-full bg-brand text-[17px] font-black text-white">{n}</span>
                <b className="mt-4 block text-[17px] font-extrabold leading-6">{t}</b>
                <span className="mt-1 block text-[14px] text-ink-2">{d}</span>
              </div>
            ))}
          </div>
          <p className="reveal mt-5 flex flex-wrap gap-2 text-[14px] font-bold text-ink-2">
            {['لا رأس مال', 'لا مخزن', 'لا توصيل', 'لا رسوم اشتراك'].map((x) => <span key={x} className="rounded-full bg-card px-3.5 py-1.5 ring-1 ring-line">{x}</span>)}
          </p>
        </section>

        {/* الربح */}
        <section aria-labelledby="profit">
          <p className="reveal eyebrow !text-brand">كيف تربح؟</p>
          <h2 id="profit" className="reveal mb-6 mt-3 text-[28px] font-black leading-[40px] [text-wrap:balance]">أنت تحدّد ربحك على كل قطعة</h2>
          <ProfitExample />
        </section>

        {/* التحويل */}
        <section aria-labelledby="pay" className="reveal rounded-[28px] bg-card p-6 shadow-[var(--shadow-card)]">
          <p className="eyebrow !text-brand">أرباحك</p>
          <h2 id="pay" className="mt-3 text-[24px] font-black leading-9">تصلك إلى زين كاش أو كي كارد</h2>
          <p className="mt-3 text-[16px] font-light leading-8 text-ink-2">تضيف حسابك عند التسجيل. بعد تسليم كل طلب بأيام قليلة يصبح ربحه متاحاً، فتطلب تحويله بضغطة، أو نطلبه لك تلقائياً حين يبلغ رصيدك المتاح 25 ألف دينار. وتتابع كل دينار من «أرباحي».</p>
        </section>

        {/* التسجيل */}
        <section id="start" aria-labelledby="start-h" className="scroll-mt-6">
          <h2 id="start-h" className="text-[28px] font-black leading-[40px]">{entry === 'in' ? 'أهلاً بعودتك' : 'ابدأ متجرك الآن'}</h2>
          <p className="mt-2 text-[15px] text-ink-2">{entry === 'in' ? 'ادخل برقم هاتفك أو بتيليغرام.' : 'دقيقتان، ومجاناً.'}</p>
          <div className="mt-6 grid grid-cols-2 rounded-2xl bg-wash p-1" role="tablist" aria-label="طريقة الدخول">
            {[['phone', 'رقم الهاتف'], ['telegram', 'تيليغرام']].map(([k, label]) => {
              const on = (entry === 'telegram') === (k === 'telegram')
              return <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setEntry(k === 'telegram' ? 'telegram' : 'new')}
                className={`min-h-12 rounded-xl text-[15px] transition ${on ? 'bg-card font-bold text-ink shadow-[var(--shadow-card)]' : 'font-medium text-mute'}`}>{label}</button>
            })}
          </div>
          <div className="mt-7">{entry === 'telegram' ? <TelegramLogin /> : <PhoneLogin key={entry ?? 'new'} initial={entry === 'in' ? 'in' : 'new'} />}</div>
        </section>
      </div>
      <footer className="border-t hairline py-8 text-center text-[13px] text-mute"><span className="font-extrabold text-brand">رزق</span> · razq.store</footer>
    </div>
  )
}

function PhoneLogin({ initial = 'new' }) {
  const [mode, setMode] = useState(initial)              // in | new
  const [f, setF] = useState({ phone: '', password: '', name: '' })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (p) => { setF({ ...f, ...p }); setErr(null) }

  const submit = async (e) => {
    e.preventDefault()
    const phone = phoneOf(f.phone)
    if (!phone) return setErr('أدخل رقم موبايل عراقي صحيح، مثل 07701234567')
    if (f.password.length < 8) return setErr('كلمة السر من 8 أحرف على الأقل')
    if (mode === 'new' && f.name.trim().length < 2) return setErr('اكتب اسمك')
    setBusy(true); setErr(null)
    try {
      if (mode === 'new') await rpc('reseller_phone_register', { p_phone: phone, p_password: f.password, p_name: f.name.trim() })
      const { error } = await sb.auth.signInWithPassword({ email: phoneEmail(phone), password: f.password })
      if (error) throw Object.assign(new Error(/invalid/i.test(error.message) ? 'رقم الهاتف أو كلمة السر غير صحيحة' : 'تعذّر الدخول، حاول مرة أخرى'), { code: 'P0001' })
    } catch (x) { setErr(errText(x)) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {err && <Notice tone="bad">{err}</Notice>}
      {mode === 'new' && (
        <Field id="l-name" label="اسمك">
          <input id="l-name" className={field} value={f.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" maxLength={80} />
        </Field>
      )}
      <Field id="l-phone" label="رقم الموبايل">
        <input id="l-phone" className={`${field} num text-right`} dir="ltr" type="tel" inputMode="tel" autoComplete="tel" placeholder="07701234567"
          value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
      </Field>
      <Field id="l-pass" label="كلمة السر" hint={mode === 'new' ? '8 أحرف على الأقل. احفظها، فهي مفتاح متجرك.' : undefined}>
        <input id="l-pass" className={field} type="password" autoComplete={mode === 'new' ? 'new-password' : 'current-password'}
          value={f.password} onChange={(e) => set({ password: e.target.value })} />
      </Field>
      <Button variant="ink" type="submit" disabled={busy}>{busy ? 'لحظة…' : mode === 'new' ? 'إنشاء حسابي' : 'دخول'}</Button>
      <p className="text-center text-[15px] text-ink-2">
        {mode === 'new' ? 'لديك حساب؟ ' : 'أول مرة هنا؟ '}
        <button type="button" onClick={() => { setMode(mode === 'new' ? 'in' : 'new'); setErr(null) }} className="min-h-11 font-bold text-ink underline decoration-line decoration-2 underline-offset-8">
          {mode === 'new' ? 'ادخل' : 'أنشئ حساباً'}
        </button>
      </p>
      {mode === 'in' && <p className="text-center text-[13px] text-mute">نسيت كلمة السر؟ ادخل بتيليغرام إن كان مربوطاً، أو راسل الدعم.</p>}
    </form>
  )
}

/** تيليغرام: يحفظ الرقم، يفتح البوت، ويدخل وحده بعد ضغط الرقم الصحيح */
function TelegramLogin() {
  const [s, setS] = useState({ phase: 'starting' })     // starting | waiting | error
  const [note, setNote] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const begin = async (why) => {
    keep(null)
    setNote(why ?? null); setS({ phase: 'starting' })
    const secret = hex(32)
    try {
      const r = await rpc('reseller_login_start', { p_secret: secret })
      if (!alive.current) return
      const v = { ...r, secret, at: Date.now() }
      keep(v); setS({ phase: 'waiting', ...v })
    } catch (e) { setS({ phase: 'error', text: errText(e) }) }
  }
  useEffect(() => { const v = saved(); v ? setS({ phase: 'waiting', ...v }) : begin() }, [])

  useEffect(() => {
    if (s.phase !== 'waiting') return
    let stop = false, t
    const tick = async () => {
      try {
        const r = await rpc('reseller_login_finish', { p_nonce: s.nonce, p_secret: s.secret })
        if (stop) return
        if (r.status === 'ok') {
          keep(null)
          const { error } = await sb.auth.signInWithPassword({ email: r.email, password: r.password })
          if (error) throw error
          await rpc('reseller_login_seal').catch(() => {})
          return
        }
        if (r.status === 'failed') return begin('الرقم الذي اخترته غير صحيح. حاول مرة أخرى.')
        if (r.status === 'expired') return begin('انتهت المهلة. حاول مرة أخرى.')
      } catch (e) { if (!stop) return setS({ phase: 'error', text: errText(e) }) }
      t = setTimeout(tick, 2000)
    }
    t = setTimeout(tick, 2000)
    return () => { stop = true; clearTimeout(t) }
  }, [s.phase, s.nonce])

  return (
    <div className="space-y-4">
      {note && <Notice>{note}</Notice>}
      {s.phase === 'error' && <Notice tone="bad" title="تعذّر الاتصال">{s.text}</Notice>}
      {s.phase === 'waiting' ? (
        <>
          <div className="rounded-[24px] bg-card p-6 text-center ring-1 ring-line">
            <p className="eyebrow">تذكّر هذا الرقم</p>
            <p className="num mt-2 text-[56px] font-black leading-none" aria-label={`الرقم ${s.number}`}>{s.number}</p>
          </div>
          <a href={s.bot} target="_blank" rel="noopener noreferrer" className="flex min-h-13 w-full items-center justify-center rounded-2xl bg-[#229ed9] px-5 text-[16px] font-bold text-white">افتح تيليغرام</a>
          <ol className="space-y-1.5 pt-1 text-[15px] leading-7 text-ink-2">
            <li>١. في تيليغرام اضغط «Start».</li>
            <li>٢. ستظهر ثلاثة أرقام: اضغط {s.number}.</li>
            <li>٣. ارجع إلى هنا، وستدخل وحدك.</li>
          </ol>
          {import.meta.env.DEV && import.meta.env.MODE !== 'live' && (
            <div className="rounded-2xl border-2 border-dashed border-warn p-4" aria-label="تجربة محلية">
              <p className="mb-3 text-[13px] font-bold text-warn">للتجربة المحلية فقط — يحاكي تيليغرام</p>
              {[[111, 'ادخل كصاحب «متجر النور»'], [222, 'ادخل كمروّج جديد']].map(([tg, t]) => (
                <button key={tg} type="button" className="mb-2 min-h-12 w-full rounded-xl bg-wash px-3 text-[15px] font-bold"
                  onClick={() => fetch('/dev/telegram/auto', { method: 'POST', body: JSON.stringify({ tg, number: s.number, nonce: s.nonce }) })}>{t}</button>
              ))}
            </div>
          )}
        </>
      ) : (
        <Button variant="ink" disabled={s.phase === 'starting'} onClick={() => begin()}>{s.phase === 'starting' ? 'لحظة…' : 'إعادة المحاولة'}</Button>
      )}
    </div>
  )
}
