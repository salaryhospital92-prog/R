import { MapPin, Phone, MessageCircle, Clock } from 'lucide-react'
import { STORE, telUrl, contactWhatsappUrl } from '../lib/store'

/** بطاقة التواصل — العنوان والهاتف وزر واتساب مباشر */
export default function ContactCard({ className = '', style }) {
  return (
    <section className={`card p-5 ${className}`} style={style}>
      <h2 className="mb-3 text-base font-extrabold">تواصل معنا</h2>

      <ul className="grid gap-3 text-sm">
        <li className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50">
            <MapPin className="size-4.5 text-brand-600" />
          </span>
          <span className="pt-1.5 leading-relaxed text-slate-700">{STORE.address}</span>
        </li>

        <li className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50">
            <Phone className="size-4.5 text-brand-600" />
          </span>
          <a href={telUrl()} dir="ltr" className="font-bold tracking-wide text-slate-800 hover:text-brand-700">
            {STORE.phone}
          </a>
        </li>

        <li className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50">
            <Clock className="size-4.5 text-brand-600" />
          </span>
          <span className="text-slate-700">{STORE.hours}</span>
        </li>
      </ul>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a
          href={contactWhatsappUrl()}
          target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3 text-sm font-bold text-white transition active:scale-95 hover:bg-brand-700"
        >
          <MessageCircle className="size-4.5" /> راسلنا واتساب
        </a>
        <a
          href={telUrl()}
          className="flex items-center justify-center gap-2 rounded-2xl bg-slate-900 py-3 text-sm font-bold text-white transition active:scale-95 hover:bg-slate-800"
        >
          <Phone className="size-4.5" /> اتصال
        </a>
      </div>
    </section>
  )
}

/** زر واتساب عائم — يظهر في صفحات المتجر */
export function FloatingWhatsapp({ bottom = 'bottom-5' }) {
  return (
    <a
      href={contactWhatsappUrl()}
      target="_blank" rel="noopener noreferrer"
      aria-label="تواصل معنا عبر واتساب"
      className={`animate-pop fixed ${bottom} end-4 z-40 flex size-13 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 transition active:scale-90 hover:bg-brand-700`}
    >
      <MessageCircle className="size-6" />
    </a>
  )
}
