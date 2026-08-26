import { Link, useNavigate } from 'react-router-dom'
import { ShoppingBag, Boxes, ChevronLeft, Sparkles, LogIn } from 'lucide-react'
import { useCart } from '../../context/CartContext'
import { STORE } from '../../lib/store'
import ContactCard from '../../components/ContactCard'

export default function ModeSelect() {
  const navigate = useNavigate()
  const { setMode, count, mode } = useCart()

  const pick = (m) => {
    setMode(m)
    navigate(m === 'wholesale' ? '/wholesale' : '/retail')
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-5 pb-10 pt-10">
      <header className="animate-fade-up text-center">
        <img src="/icon-192.png" alt="" className="mx-auto size-20 rounded-3xl shadow-lg shadow-brand-600/20" />
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">{STORE.name}</h1>
        <p className="mt-1.5 text-sm text-slate-500">{STORE.addressShort}</p>

        <p className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3.5 py-1.5 text-xs font-semibold text-brand-900 ring-1 ring-brand-600/15">
          <Sparkles className="size-3.5" />
          عطور · بشرة · كوزمتك · مواد منزلية
        </p>
      </header>

      <p className="animate-fade-up mt-9 text-center text-sm font-bold text-slate-500" style={{ animationDelay: '80ms' }}>
        كيف تحب تتسوّق؟
      </p>

      <div className="mt-3 grid gap-3">
        <ModeButton
          onClick={() => pick('retail')} delay="140ms"
          icon={<ShoppingBag className="size-7" />}
          title="شراء مفرد" subtitle="بالقطعة — للاستعمال الشخصي"
          tone="from-brand-500 to-brand-700"
        />
        <ModeButton
          onClick={() => pick('wholesale')} delay="200ms"
          icon={<Boxes className="size-7" />}
          title="شراء جملة" subtitle="بالدرزن — أسعار أقل للكميات"
          tone="from-amber-500 to-orange-600"
        />
      </div>

      {count > 0 && mode && (
        <button
          onClick={() => navigate(mode === 'wholesale' ? '/wholesale' : '/retail')}
          className="animate-fade-up mt-3 w-full rounded-2xl bg-slate-900 py-3.5 text-sm font-bold text-white transition active:scale-[0.98]"
          style={{ animationDelay: '260ms' }}
        >
          متابعة سلّتك السابقة ({count} منتج)
        </button>
      )}

      <ContactCard className="animate-fade-up mt-8" style={{ animationDelay: '320ms' }} />

      <Link
        to="/dashboard"
        className="animate-fade-up mt-4 flex items-center justify-center gap-2 rounded-2xl bg-white/70 py-3 text-sm font-bold text-slate-600 ring-1 ring-slate-900/5 transition hover:bg-white hover:text-slate-900"
        style={{ animationDelay: '380ms' }}
      >
        <LogIn className="size-4" /> دخول الإدارة
      </Link>

      <p className="mt-6 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} {STORE.name}
      </p>
    </main>
  )
}

function ModeButton({ onClick, icon, title, subtitle, tone, delay }) {
  return (
    <button
      onClick={onClick}
      style={{ animationDelay: delay }}
      className="animate-fade-up card group flex items-center gap-4 p-4 text-start shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-xl active:scale-[0.98]"
    >
      <span className={`flex size-15 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${tone} text-white shadow-md`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-extrabold">{title}</span>
        <span className="block text-sm text-slate-500">{subtitle}</span>
      </span>
      <ChevronLeft className="size-5 shrink-0 text-slate-300 transition group-hover:-translate-x-0.5 group-hover:text-slate-500" />
    </button>
  )
}
