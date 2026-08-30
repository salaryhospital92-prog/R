import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { X, Home, MapPin, MessageCircle, LogIn, Phone, Clock, ChevronLeft } from 'lucide-react'
import { STORE, telUrl, contactWhatsappUrl, asset } from '../lib/store'

const mapsUrl = () =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(STORE.address)}`

/**
 * القائمة الجانبية — تنزلق من جهة البداية (اليمين في العربية).
 *
 * الوصول: نافذة حوارية حقيقية (role=dialog + aria-modal)، التركيز ينتقل إليها
 * عند الفتح ويعود لزرّ الفتح عند الإغلاق، وTab محبوس داخلها، وEscape يغلقها،
 * وتمرير الصفحة خلفها مُجمَّد حتى لا يضيع مكان القارئ.
 */
export default function SideMenu({ open, onClose, returnFocusTo }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const onKey = (e) => {
      if (e.key === 'Escape') return onClose()
      if (e.key !== 'Tab') return
      // حبس التركيز داخل اللوحة
      const items = panelRef.current?.querySelectorAll('a[href], button:not([disabled])')
      if (!items?.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      returnFocusTo?.current?.focus?.()
    }
  }, [open, onClose, returnFocusTo])

  if (!open) return null

  const row = 'flex items-center gap-3 rounded-xl p-3 text-start transition hover:bg-ink-50'

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button" onClick={onClose} tabIndex={-1} aria-hidden="true"
        className="absolute inset-0 cursor-default bg-ink-900/55"
      />

      <div
        ref={panelRef} role="dialog" aria-modal="true" aria-label="قائمة المتجر"
        className="animate-drawer absolute inset-y-0 start-0 flex w-[82%] max-w-xs flex-col bg-white shadow-2xl"
      >
        <div className="surface-ink flex items-center gap-3 p-4">
          <img src={asset('logo-mark.png')} alt="" className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold">{STORE.name}</p>
            <p className="truncate text-[11px] text-white/70">{STORE.addressShort}</p>
          </div>
          <button
            ref={closeRef} type="button" onClick={onClose} aria-label="إغلاق القائمة"
            className="flex size-10 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav aria-label="روابط المتجر" className="flex-1 overflow-y-auto p-2">
          <Link to="/" onClick={onClose} className={row}>
            <Item icon={<Home className="size-5" />} title="الرئيسية" sub="الإعلانات والأصناف" />
          </Link>

          <a href={mapsUrl()} target="_blank" rel="noopener noreferrer" onClick={onClose} className={row}>
            <Item icon={<MapPin className="size-5" />} title="العنوان" sub={STORE.addressShort} external />
          </a>

          <a href={contactWhatsappUrl()} target="_blank" rel="noopener noreferrer" onClick={onClose} className={row}>
            <Item icon={<MessageCircle className="size-5" />} title="التواصل" sub="راسلنا على واتساب" external />
          </a>

          <Link to="/dashboard" onClick={onClose} className={row}>
            <Item icon={<LogIn className="size-5" />} title="دخول الإدارة" sub="للموظفين فقط" />
          </Link>
        </nav>

        <div className="border-t border-ink-100 p-4">
          <a href={telUrl()} className="flex min-h-11 items-center gap-2 text-sm font-bold text-ink-800 hover:text-brand-800">
            <Phone className="size-4 text-brand-700" />
            <span dir="ltr" className="tnum">{STORE.phone}</span>
          </a>
          <p className="mt-1 flex items-center gap-2 text-[12px] text-ink-600">
            <Clock className="size-4 text-ink-400" /> {STORE.hours}
          </p>
        </div>
      </div>
    </div>
  )
}

function Item({ icon, title, sub, external }) {
  return (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-800">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-extrabold text-ink-900">{title}</span>
        <span className="block truncate text-[12px] text-ink-600">{sub}</span>
      </span>
      <ChevronLeft className={`size-4 shrink-0 text-ink-400 ${external ? '-rotate-45' : ''}`} />
    </>
  )
}
