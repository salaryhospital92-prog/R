import { useEffect, useRef, useState } from 'react'
import { errText } from '../lib/config'
import { phoneOf } from '../lib/format'
import { Button, Field, Notice, field } from '../ui'
import Landing from './Landing'
import { rpc, sb } from './sb'

// المحاولة الجارية تُحفظ في الجلسة: فتح تيليغرام قد يعيد تحميل الصفحة، فتستأنفها بدل أن تبدأ جديدة ويضيع تأكيدك
const KEY = 'razq-login'
const saved = () => { try { const v = JSON.parse(sessionStorage.getItem(KEY)); return v && Date.now() - v.at < 170000 ? v : null } catch { return null } }
const keep = (v) => { try { v ? sessionStorage.setItem(KEY, JSON.stringify(v)) : sessionStorage.removeItem(KEY) } catch { /* وضع خاص */ } }
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('')
/** البريد التركيبي لحساب الهاتف (كما ينشئه reseller_phone_register) */
const phoneEmail = (local) => `ph964${local.slice(1)}@phone.invalid`

export default function Login() {
  const [entry, setEntry] = useState(() => (saved() ? 'telegram' : null))   // null | new | in | telegram
  // إلى نموذج الدخول فوراً (الصفحة طويلة)، ويبقى عليه إن طالت الصفحة بعد وصول الصور والمناطق، حتى يلمس المستخدم الشاشة
  const toStart = () => {
    const go = () => document.getElementById('start')?.scrollIntoView({ block: 'start' })
    go(); document.getElementById('start-h')?.focus({ preventScroll: true })
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(go); ro.observe(document.body)
    const stop = () => { ro.disconnect(); removeEventListener('touchstart', stop); removeEventListener('wheel', stop) }
    addEventListener('touchstart', stop, { passive: true }); addEventListener('wheel', stop, { passive: true }); setTimeout(stop, 5000)
  }
  const start = (how) => { setEntry(how); requestAnimationFrame(toStart) }
  useEffect(() => { if (saved()) requestAnimationFrame(toStart) }, [])   // العودة من تيليغرام: مباشرة إلى المحاولة الجارية

  return (
    <div className="overflow-x-clip">
      <Landing onStart={start} />
      <div className="mx-auto max-w-md px-6 pb-16 pt-20">
        {/* التسجيل */}
        <section id="start" aria-labelledby="start-h" className="scroll-mt-6">
          <h2 id="start-h" tabIndex={-1} className="text-[28px] font-black leading-[40px] outline-none">{entry === 'in' ? 'أهلاً بعودتك' : 'ابدأ متجرك الآن'}</h2>
          <p className="mt-2 text-[15px] text-ink-2">{entry === 'in' ? 'ادخل برقم هاتفك أو بتيليغرام.' : 'دقيقتان، ومجاناً.'}</p>
          <div className="mt-6 grid grid-cols-2 rounded-2xl bg-wash p-1" role="tablist" aria-label="طريقة الدخول">
            {[['phone', 'رقم الهاتف'], ['telegram', 'تيليغرام']].map(([k, label]) => {
              const on = (entry === 'telegram') === (k === 'telegram')
              return <button key={k} type="button" role="tab" aria-selected={on} onClick={() => setEntry(k === 'telegram' ? 'telegram' : entry === 'telegram' ? 'new' : entry)}
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
      if (mode === 'new') {
        const r = await rpc('reseller_phone_register', { p_phone: phone, p_password: f.password, p_name: f.name.trim() })
        if (r?.status === 'exists') { setMode('in'); return setErr('هذا الرقم مسجَّل. ادخل بكلمة السر، أو بتيليغرام إن كان مربوطاً.') }
      }
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
