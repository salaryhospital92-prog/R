import { useEffect, useState } from 'react'
import { logoUrl } from './lib/config'
import { back, go, href } from './lib/route'

// مكوّنات مشتركة بين المتجر واللوحة. الأيقونات قليلة ولا تأتي إلا مع نص أو تسمية للوصول.

/** شعار المتجر، أو أول حرف من اسمه بلون المتجر */
export const Logo = ({ store, size = 44 }) => {
  const [bad, setBad] = useState(false)
  const src = logoUrl(store.logo_path)
  const s = { width: size, height: size }
  return src && !bad
    ? <img src={src} alt="" style={s} className="shrink-0 rounded-2xl bg-card object-cover ring-1 ring-line" referrerPolicy="no-referrer" onError={() => setBad(true)} />
    : <span style={{ ...s, fontSize: size * 0.46 }} className="grid shrink-0 place-items-center rounded-2xl bg-brand font-black text-brand-ink" aria-hidden="true">{initial(store.name)}</span>
}
export const initial = (name) => [...String(name ?? '').replace(/^ال(?=.)/, '')][0] ?? ''

export const ProductImage = ({ p, className = '' }) => {
  const [bad, setBad] = useState(false)
  const [ready, setReady] = useState(false)
  return (
    <div className={`relative aspect-square overflow-hidden bg-wash ${className}`}>
      {p.image_url && !bad
        ? <img src={p.image_url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} onLoad={() => setReady(true)}
            className={`size-full object-cover transition-opacity duration-500 ${ready ? 'opacity-100' : 'opacity-0'}`} />
        : <span className="absolute inset-0 grid place-items-center px-3 text-center text-[13px] font-medium leading-5 text-mute">{p.name}</span>}
    </div>
  )
}

/** أزرار: أساسي بلون العلامة، حبر، هادئ، ونصي */
const BTN = {
  primary: 'bg-brand text-brand-ink hover:brightness-[.97]',
  ink: 'bg-ink text-white hover:bg-ink-2',
  quiet: 'bg-wash text-ink hover:bg-line',
  outline: 'bg-card text-ink ring-1 ring-line hover:bg-wash',
}
export const Button = ({ children, variant = 'primary', className = '', ...p }) => (
  <button type="button" {...p}
    className={`flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl px-5 text-[16px] font-bold transition active:scale-[.985] disabled:pointer-events-none disabled:bg-wash disabled:text-mute ${BTN[variant]} ${className}`}>
    {children}
  </button>
)

/** حقل بتسمية فوقه، وتلميح أو خطأ تحته */
export const field = 'min-h-13 w-full rounded-2xl bg-wash px-4 text-[16px] outline-none ring-1 ring-transparent transition placeholder:text-mute focus:bg-card focus:ring-brand aria-[invalid=true]:ring-bad'
export function Field({ id, label, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[14px] font-bold text-ink-2">{label}</label>
      {children}
      {error ? <p id={`${id}-err`} className="mt-2 text-[14px] font-medium text-bad">{error}</p>
        : hint && <p className="mt-2 text-[13px] leading-5 text-mute">{hint}</p>}
    </div>
  )
}

/** عدّاد كمية بالنص: − العدد + */
export const Stepper = ({ value, min, max, onChange, onRemove, label, size = 'md' }) => {
  const atMin = value <= min
  const h = size === 'sm' ? 'h-10 w-10 text-[20px]' : 'h-12 w-12 text-[22px]'
  return (
    <div className="inline-flex items-center rounded-full bg-wash p-1" role="group" aria-label={label}>
      <button type="button" className={`${h} grid place-items-center rounded-full font-medium text-ink transition active:scale-95 disabled:text-line`}
        aria-label={atMin && onRemove ? 'حذف من السلة' : 'إنقاص'} disabled={atMin && !onRemove} onClick={() => (atMin ? onRemove() : onChange(value - 1))}>
        {atMin && onRemove ? <span className="text-[13px] font-bold">حذف</span> : '−'}
      </button>
      <span className="num min-w-9 text-center text-[16px] font-bold" aria-live="polite">{value}</span>
      <button type="button" className={`${h} grid place-items-center rounded-full bg-card font-medium text-ink shadow-[var(--shadow-card)] transition active:scale-95 disabled:bg-transparent disabled:text-line disabled:shadow-none`}
        aria-label="زيادة" disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  )
}

/** تنبيه بشريط لون جانبي بلا أيقونة */
export const Notice = ({ tone = 'warn', title, children, onClose }) => {
  const c = { ok: 'border-ok bg-[#eef7f1]', info: 'border-ink-2 bg-wash', warn: 'border-warn bg-[#fbf5e9]', bad: 'border-bad bg-[#fcefee]' }[tone]
  return (
    <div role={tone === 'warn' || tone === 'bad' ? 'alert' : 'status'} className={`rise flex items-start gap-3 rounded-2xl border-s-4 p-4 text-[15px] leading-6 ${c}`}>
      <div className="min-w-0 flex-1">{title && <p className="font-bold">{title}</p>}<div className="text-ink-2">{children}</div></div>
      {onClose && <button type="button" onClick={onClose} className="-m-1 shrink-0 rounded-xl px-2 py-1 text-[13px] font-bold text-mute hover:text-ink">إغلاق</button>}
    </div>
  )
}

/** صفحة فرعية للمتجر: رأس برجوع وعنوان، ومحتوى، وتذييل ثابت اختياري */
export const Page = ({ title, back: showBack = true, fallback, children, footer }) => (
  <div className="mx-auto flex min-h-dvh max-w-2xl flex-col bg-paper">
    <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 bg-paper/90 px-5 py-2 backdrop-blur">
      <h1 className="truncate text-[19px] font-extrabold">{title}</h1>
      {showBack && <button type="button" onClick={() => back(fallback)} className="-me-2 min-h-12 shrink-0 rounded-2xl px-2 text-[15px] font-bold text-mute hover:bg-wash">رجوع</button>}
    </header>
    <main className="flex-1 px-5 pb-6 pt-2">{children}</main>
    {footer && <div className="sticky bottom-0 z-20 border-t hairline bg-card/95 px-5 pt-4 backdrop-blur safe-b">{footer}</div>}
  </div>
)

/** لوح سفلي (حوار) */
export const Sheet = ({ title, onClose, children }) => {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-ink/40" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet mx-auto max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-card px-5 pb-2 pt-3 safe-b" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-line" aria-hidden="true" />
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 className="text-[20px] font-extrabold leading-8">{title}</h2>
          <button type="button" onClick={onClose} className="-me-2 min-h-11 shrink-0 rounded-2xl px-2 text-[15px] font-bold text-mute hover:bg-wash">إغلاق</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** شاشة حالة كاملة: عنوان كبير ونص هادئ وإجراء */
export const StateScreen = ({ title, text, action }) => (
  <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-8 text-center">
    <div className="rise">
      <h1 className="text-[26px] font-black leading-10">{title}</h1>
      {text && <p className="mt-3 text-[16px] leading-7 text-ink-2">{text}</p>}
      {action && <div className="mt-8">{action}</div>}
    </div>
  </div>
)

/** شارة حالة نصية */
export const Badge = ({ tone = 'mute', children }) => {
  const c = { ok: 'bg-[#e7f4ec] text-ok', warn: 'bg-[#fbf1dc] text-warn', bad: 'bg-[#fbe4e2] text-bad', brand: 'bg-brand-soft text-brand-deep', mute: 'bg-wash text-ink-2' }[tone]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-bold ${c}`}>{children}</span>
}

/** رابط داخل المتجر: <a> حقيقي (نسخ الرابط/فتح بتبويب) مع تنقّل بلا تحميل */
export const Link = ({ to, children, ...p }) => (
  <a href={href(to)} {...p} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); go(to) }}>{children}</a>
)

export const Redirect = ({ to }) => { useEffect(() => go(to, { replace: true }), [to]); return null }
