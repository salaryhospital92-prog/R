import { useEffect, useState } from 'react'
import { ArrowRight, Check, Info, Minus, Package, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { logoUrl } from './lib/api'
import { back, go, href } from './lib/route'

export const Logo = ({ store, size = 44 }) => {
  const [bad, setBad] = useState(false)
  const src = logoUrl(store.logo_path)
  const s = { width: size, height: size }
  return src && !bad
    ? <img src={src} alt="" style={s} className="shrink-0 rounded-xl bg-white object-cover ring-1 ring-black/5" referrerPolicy="no-referrer" onError={() => setBad(true)} />
    : <span style={{ ...s, fontSize: size * 0.45 }} className="grid shrink-0 place-items-center rounded-xl bg-brand font-bold text-brand-ink" aria-hidden="true">{[...store.name.replace(/^ال(?=.)/, '')][0]}</span>
}

export const ProductImage = ({ p, className = '' }) => {
  const [bad, setBad] = useState(false)
  return (
    <div className={`relative aspect-square overflow-hidden bg-stone-100 ${className}`}>
      {p.image_url && !bad
        ? <img src={p.image_url} alt={p.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} className="size-full object-cover" />
        : <Package className="absolute inset-0 m-auto size-1/4 text-stone-300" aria-hidden="true" />}
    </div>
  )
}

/** عدّاد كمية. عند الحدّ الأدنى يصير الناقص حذفاً إن مُرِّرت onRemove */
export const Stepper = ({ value, min, max, onChange, onRemove, label }) => {
  const atMin = value <= min
  const btn = 'grid size-11 place-items-center rounded-xl text-brand-deep transition active:scale-95 disabled:text-stone-300'
  return (
    <div className="inline-flex items-center rounded-xl bg-brand-soft" role="group" aria-label={label}>
      <button type="button" className={btn} aria-label={atMin && onRemove ? 'حذف من السلة' : 'إنقاص'}
        disabled={atMin && !onRemove} onClick={() => (atMin ? onRemove() : onChange(value - 1))}>
        {atMin && onRemove ? <Trash2 className="size-5" /> : <Minus className="size-5" />}
      </button>
      <span className="min-w-8 text-center text-base font-bold tabular-nums" aria-live="polite">{value}</span>
      <button type="button" className={btn} aria-label="زيادة" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus className="size-5" />
      </button>
    </div>
  )
}

export const Notice = ({ tone = 'warn', title, children, onClose }) => {
  const Icon = tone === 'ok' ? Check : tone === 'info' ? Info : TriangleAlert
  const color = tone === 'ok' ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : tone === 'info' ? 'bg-sky-50 text-sky-900 ring-sky-200' : 'bg-amber-50 text-amber-950 ring-amber-200'
  return (
    <div role={tone === 'warn' ? 'alert' : 'status'} className={`rise flex gap-3 rounded-2xl p-3.5 text-[15px] leading-6 ring-1 ${color}`}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{title && <p className="font-bold">{title}</p>}{children}</div>
      {onClose && <button type="button" onClick={onClose} aria-label="إغلاق" className="-m-2 grid size-11 shrink-0 place-items-center"><X className="size-4" /></button>}
    </div>
  )
}

export const Page = ({ title, back: showBack = true, fallback, children, footer }) => (
  <div className="mx-auto flex min-h-dvh max-w-2xl flex-col bg-white shadow-[0_0_0_1px_rgba(0,0,0,.03)] sm:my-0">
    <header className="sticky top-0 z-20 flex items-center gap-1 border-b border-stone-100 bg-white/95 px-2 py-1.5 backdrop-blur">
      {showBack && <button type="button" onClick={() => back(fallback)} aria-label="رجوع" className="grid size-11 place-items-center rounded-xl active:bg-stone-100"><ArrowRight className="size-6" /></button>}
      <h1 className="truncate px-1 text-lg font-bold">{title}</h1>
    </header>
    <main className="flex-1 px-4 py-4">{children}</main>
    {footer && <div className="sticky bottom-0 z-20 border-t border-stone-100 bg-white/95 px-4 pt-3 backdrop-blur safe-b">{footer}</div>}
  </div>
)

export const Button = ({ children, className = '', ...p }) => (
  <button type="button" {...p}
    className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-base font-bold text-brand-ink transition active:scale-[.98] disabled:bg-stone-200 disabled:text-stone-500 ${className}`}>
    {children}
  </button>
)

/** شاشة حالة كاملة: غير متاح، خطأ اتصال... */
export const StateScreen = ({ icon: Icon, title, text, action }) => (
  <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-6 text-center">
    <div className="rise">
      <div className="mx-auto mb-5 grid size-16 place-items-center rounded-3xl bg-stone-100 text-stone-500"><Icon className="size-8" aria-hidden="true" /></div>
      <h1 className="text-xl font-bold">{title}</h1>
      {text && <p className="mt-2 leading-7 text-stone-600">{text}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  </div>
)

/** رابط داخل المتجر: <a> حقيقي (نسخ الرابط/فتح بتبويب) مع تنقّل بلا تحميل */
export const Link = ({ to, children, ...p }) => (
  <a href={href(to)} {...p} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); go(to) }}>{children}</a>
)

export const Redirect = ({ to }) => { useEffect(() => go(to, { replace: true }), [to]); return null }
