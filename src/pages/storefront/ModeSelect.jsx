import { useNavigate } from 'react-router-dom'
import { Store, ShoppingBag, Boxes, MapPin } from 'lucide-react'
import { useCart } from '../../context/CartContext'

export default function ModeSelect() {
  const navigate = useNavigate()
  const { setMode, count, mode } = useCart()

  const pick = (m) => {
    setMode(m)
    navigate(m === 'wholesale' ? '/wholesale' : '/retail')
  }

  const card = 'group w-full rounded-3xl bg-white p-6 text-start shadow-sm transition active:scale-[0.98] hover:shadow-md'

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-5">
      <header className="animate-fade-up text-center">
        <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-emerald-600">
          <Store className="size-8 text-white" />
        </span>
        <h1 className="mt-3 text-2xl font-bold">أسواق الرفاعي</h1>
        <p className="mt-1 flex items-center justify-center gap-1 text-sm text-slate-500">
          <MapPin className="size-4" /> الرمادي — شارع السينما، فرع الشورجة
        </p>
      </header>

      <p className="animate-fade-up text-center text-sm font-semibold text-slate-600" style={{ animationDelay: '80ms' }}>
        كيف تحب تتسوّق؟
      </p>

      <button onClick={() => pick('retail')} className={card + ' animate-fade-up'} style={{ animationDelay: '140ms' }}>
        <span className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 transition group-hover:bg-emerald-100">
            <ShoppingBag className="size-7 text-emerald-600" />
          </span>
          <span>
            <span className="block text-lg font-bold">شراء مفرد</span>
            <span className="block text-sm text-slate-500">بالقطعة — للاستعمال الشخصي</span>
          </span>
        </span>
      </button>

      <button onClick={() => pick('wholesale')} className={card + ' animate-fade-up'} style={{ animationDelay: '200ms' }}>
        <span className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-amber-50 transition group-hover:bg-amber-100">
            <Boxes className="size-7 text-amber-600" />
          </span>
          <span>
            <span className="block text-lg font-bold">شراء جملة</span>
            <span className="block text-sm text-slate-500">بالدرزن — أسعار أقل للكميات</span>
          </span>
        </span>
      </button>

      {count > 0 && mode && (
        <button
          onClick={() => navigate(mode === 'wholesale' ? '/wholesale' : '/retail')}
          className="animate-fade-up rounded-2xl bg-slate-800 py-3 font-semibold text-white"
          style={{ animationDelay: '260ms' }}
        >
          متابعة سلّتك السابقة ({count} منتج)
        </button>
      )}
    </main>
  )
}
