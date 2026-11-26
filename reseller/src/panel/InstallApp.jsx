import { useEffect, useState } from 'react'

// تثبيت رزق كتطبيق: أندرويد بزر التثبيت الأصلي (beforeinstallprompt)، والآيفون بشرح «إضافة إلى الشاشة الرئيسية».
// لا يظهر داخل التطبيق المثبَّت، ولا بعد التثبيت، و«لاحقاً» تخفيه أسبوعاً.
const KEY = 'razq-install'
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) ?? {} } catch { return {} } }
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* وضع خاص */ } }
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

let deferred = null   // يُلتقط مبكراً حتى لو ظهر الحدث قبل تركيب المكوّن
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; dispatchEvent(new Event('razq-can-install')) })
addEventListener('appinstalled', () => write({ installed: true }))

export default function InstallApp({ className = '' }) {
  const [show, setShow] = useState(false)
  const [can, setCan] = useState(!!deferred)
  const [help, setHelp] = useState(false)
  useEffect(() => {
    const s = read()
    if (standalone() || s.installed || (s.later && Date.now() - s.later < 7 * 864e5)) return
    const t = setTimeout(() => setShow(true), 2500)
    const on = () => setCan(true)
    addEventListener('razq-can-install', on)
    const done = () => setShow(false)
    addEventListener('appinstalled', done)
    return () => { clearTimeout(t); removeEventListener('razq-can-install', on); removeEventListener('appinstalled', done) }
  }, [])
  if (!show) return null

  const install = async () => {
    if (!deferred) return setHelp(true)
    deferred.prompt()
    const { outcome } = await deferred.userChoice
    deferred = null; setCan(false)
    if (outcome === 'accepted') { write({ installed: true }); setShow(false) }
  }
  const later = () => { write({ later: Date.now() }); setShow(false) }
  const iphone = ios()

  return (
    <div className={`fixed inset-x-0 z-40 px-4 ${className}`}>
      <div role="dialog" aria-label="ثبّت رزق على هاتفك" className="glass rise mx-auto max-w-md rounded-[24px] p-4 text-ink">
        {!help ? (
          <div className="flex items-center gap-3">
            <img src="/razq-192.png" alt="" className="size-12 shrink-0 rounded-2xl ring-1 ring-black/5" />
            <div className="min-w-0 flex-1">
              <b className="block text-[15px] font-extrabold">ثبّت رزق على هاتفك</b>
              <span className="block text-[12.5px] text-ink-2">يفتح كتطبيق من شاشتك الرئيسية، بلا متجر تطبيقات.</span>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <button type="button" onClick={iphone || !can ? () => setHelp(true) : install} className="min-h-10 rounded-xl bg-brand px-4 text-[14px] font-black text-white shadow-[0_6px_16px_-6px_rgb(10_92_66/.6)]">{iphone || !can ? 'كيف؟' : 'تثبيت'}</button>
              <button type="button" onClick={later} className="min-h-8 rounded-xl text-[12px] font-bold text-mute">لاحقاً</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between">
              <b className="text-[15px] font-extrabold">{iphone ? 'التثبيت على الآيفون' : 'التثبيت على أندرويد'}</b>
              <button type="button" onClick={later} className="min-h-10 rounded-xl px-2 text-[13px] font-bold text-mute">إغلاق</button>
            </div>
            <ol className="mt-3 space-y-2.5 text-[14px] leading-6">
              {(iphone
                ? ['افتح هذه الصفحة من متصفح Safari.', 'اضغط زر المشاركة أسفل الشاشة (مربع يخرج منه سهم للأعلى).', 'مرّر القائمة واختر «إضافة إلى الشاشة الرئيسية».', 'اضغط «إضافة» في الأعلى، وستجد رزق بين تطبيقاتك.']
                : ['افتح هذه الصفحة من متصفح Chrome.', 'اضغط زر القائمة (النقاط الثلاث ⋮) أعلى الشاشة.', 'اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».', 'اضغط «تثبيت»، وستجد رزق بين تطبيقاتك.']
              ).map((s, i) => (
                <li key={i} className="flex gap-3"><span className="num grid size-6 shrink-0 place-items-center rounded-full bg-brand text-[12px] font-black text-white">{i + 1}</span><span>{s}</span></li>
              ))}
            </ol>
            <button type="button" onClick={() => { write({ installed: true }); setShow(false) }} className="mt-4 min-h-11 w-full rounded-xl bg-brand-soft text-[14px] font-bold text-brand">ثبّتُّه، لا تُظهر هذا مرة أخرى</button>
          </div>
        )}
      </div>
    </div>
  )
}
