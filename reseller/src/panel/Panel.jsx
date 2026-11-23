import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { CircleCheck, Clock, Home as HomeIcon, LogOut, MoreHorizontal, Package, ShoppingBag, Wallet, X } from 'lucide-react'
import { errText } from '../lib/config'
import { logoUrl } from '../lib/config'
import { Button, Notice, StateScreen } from '../ui'
import { rpc, sb } from './sb'
import Login from './Login'
import Wizard from './Wizard'
import HomeTab from './HomeTab'
import Products from './Products'
import Orders from './Orders'
import Earnings from './Earnings'
import More from './More'

// تنقّل بالهاش: لا يحتاج إعداد خادم
const subs = new Set()
addEventListener('hashchange', () => subs.forEach((f) => f()))
const useHash = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => location.hash)

const inkFor = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#1c1917' : '#ffffff'
}

const TABS = [['', 'الرئيسية', HomeIcon], ['products', 'المنتجات', Package], ['orders', 'الطلبات', ShoppingBag], ['money', 'أرباحي', Wallet], ['more', 'المزيد', MoreHorizontal]]

export default function Panel() {
  const [auth, setAuth] = useState('loading')          // loading | out | in
  const [me, setMe] = useState(undefined)              // undefined: لم يُحمَّل، null: ليس مروّجاً
  const [err, setErr] = useState(null)
  const [toast, setToast] = useState(null)
  const hash = useHash()

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setAuth(data.session ? 'in' : 'out'))
    const { data } = sb.auth.onAuthStateChange((_e, s) => setAuth(s ? 'in' : 'out'))
    return () => data.subscription.unsubscribe()
  }, [])

  const reload = useCallback(async () => {
    try { setMe(await rpc('reseller_me')); setErr(null) } catch (e) { setErr(errText(e)) }
  }, [])
  useEffect(() => { if (auth === 'in') reload(); else setMe(undefined) }, [auth, reload])

  const flash = useCallback((text, action) => {
    setToast({ text, action })
    clearTimeout(flash.t); flash.t = setTimeout(() => setToast(null), 7000)
  }, [])

  const store = me?.store
  useEffect(() => {
    const c = store?.theme_color ?? '#059669'
    document.documentElement.style.setProperty('--brand', c)
    document.documentElement.style.setProperty('--on-brand', inkFor(c))
  }, [store?.theme_color])

  if (auth === 'loading' || (auth === 'in' && me === undefined && !err)) return <div className="grid min-h-dvh place-items-center"><div className="skeleton size-12 rounded-2xl" aria-label="جارٍ التحميل" /></div>
  if (auth === 'out') return <Login />
  if (err) return <StateScreen icon={Clock} title="تعذّر التحميل" text={err} action={<Button onClick={reload}>إعادة المحاولة</Button>} />
  if (!me) {
    return <StateScreen icon={X} title="هذا الحساب ليس حساب مروّج" text="ادخل بحساب تيليغرام الخاص بك."
      action={<Button onClick={() => sb.auth.signOut()}>خروج</Button>} />
  }
  if (!store || store.status === 'draft') return <Wizard me={me} reload={reload} />

  const tab = hash.replace(/^#\/?/, '').split('/')[0]
  const sub = hash.replace(/^#\/?/, '').split('/')[1] ?? ''
  const ctx = { me, store, reload, flash }
  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-white pb-24">
      <header className="flex items-center gap-3 border-b border-stone-100 px-4 py-3">
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand font-bold text-brand-ink">
          {store.logo_path ? <img src={logoUrl(store.logo_path)} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : [...store.name.replace(/^ال(?=.)/, '')][0]}
        </span>
        <div className="min-w-0 flex-1"><p className="truncate font-extrabold">{store.name}</p><p className="text-[13px] text-stone-500">لوحة المتجر</p></div>
        <button type="button" onClick={() => sb.auth.signOut()} aria-label="خروج" className="grid size-11 place-items-center rounded-xl text-stone-500 active:bg-stone-100"><LogOut className="size-5" /></button>
      </header>
      <main className="px-4 py-4">
        {store.status === 'suspended' && <div className="mb-4"><Notice title="متجرك موقوف">تواصل مع الإدارة. أرباحك محفوظة.</Notice></div>}
        {tab === 'products' ? <Products {...ctx} />
          : tab === 'orders' ? <Orders {...ctx} />
          : tab === 'money' ? <Earnings {...ctx} />
          : tab === 'more' ? <More {...ctx} sub={sub} />
          : <HomeTab {...ctx} />}
      </main>

      {toast && (
        <div className="fixed inset-x-0 bottom-20 z-40 px-4"><div role="status" className="rise mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-stone-900 px-4 py-3 text-[15px] text-white shadow-lg">
          <CircleCheck className="size-5 shrink-0 text-emerald-400" aria-hidden="true" /><span className="flex-1">{toast.text}</span>
          {toast.action && <button type="button" className="min-h-11 px-2 font-bold text-amber-300" onClick={() => { toast.action.run(); setToast(null) }}>{toast.action.label}</button>}
        </div></div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur safe-b" aria-label="التنقل">
        <ul className="mx-auto flex max-w-2xl">
          {TABS.map(([id, label, Icon]) => (
            <li key={id} className="flex-1">
              <a href={`#/${id}`} aria-current={tab === id ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px] font-medium ${tab === id ? 'text-brand-deep' : 'text-stone-500'}`}>
                <Icon className="size-6" aria-hidden="true" />{label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
