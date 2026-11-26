import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import logo from '../assets/razq-logo.png'
import { Home as HomeIcon, LayoutGrid, Menu, ReceiptText, Wallet } from 'lucide-react'
import { errText, logoUrl } from '../lib/config'
import { Button, StateScreen, initial } from '../ui'
import { rpc, sb } from './sb'
import Login from './Login'
import Wizard from './Wizard'
import HomeTab from './HomeTab'
import Products from './Products'
import Orders from './Orders'
import Earnings from './Earnings'
import More from './More'
import InstallApp from './InstallApp'

// تنقّل بالهاش: لا يحتاج إعداد خادم
const subs = new Set()
addEventListener('hashchange', () => subs.forEach((f) => f()))
const useHash = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => location.hash)

// أيقونات شريط التنقل وحدها في اللوحة، وكلها بتسمية
const TABS = [['', 'الرئيسية', HomeIcon], ['products', 'المنتجات', LayoutGrid], ['orders', 'الطلبات', ReceiptText], ['money', 'أرباحي', Wallet], ['more', 'المزيد', Menu]]

/** شعار رزق: قناع يأخذ لون العلامة (--brand)، فيتغيّر لونه من مكان واحد */
const LOGO_RATIO = 299 / 640
export const Wordmark = ({ size = 40, className = '' }) => (
  <span role="img" aria-label="رزق" className={`inline-block shrink-0 bg-brand ${className}`}
    style={{ height: size, width: Math.round(size * LOGO_RATIO), WebkitMask: `url(${logo}) center / contain no-repeat`, mask: `url(${logo}) center / contain no-repeat` }} />
)

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
    try { setMe(await rpc('reseller_me')); setErr(null) } catch (e) {
      if (e?.code === 'PGRST301' || e?.code === 'PGRST303') await sb.auth.signOut({ scope: 'local' })     // جلسة لم تعد صالحة
      else setErr(errText(e))
    }
  }, [])
  useEffect(() => { if (auth === 'in') reload(); else setMe(undefined) }, [auth, reload])

  const flash = useCallback((text, action) => {
    setToast({ text, action })
    clearTimeout(flash.t); flash.t = setTimeout(() => setToast(null), 7000)
  }, [])

  const store = me?.store
  if (auth === 'loading' || (auth === 'in' && me === undefined && !err)) return <div className="grid min-h-dvh place-items-center"><Wordmark size={72} className="animate-pulse" /></div>
  if (auth === 'out') return <><Login /><InstallApp className="bottom-4 safe-b" /></>
  if (err) return <StateScreen title="تعذّر التحميل" text={err} action={<Button variant="ink" onClick={reload}>إعادة المحاولة</Button>} />
  if (!me) return <StateScreen title="هذا الحساب ليس حساب متجر" text="ادخل برقم هاتفك أو بحساب تيليغرام الخاص بك." action={<Button variant="ink" onClick={() => sb.auth.signOut()}>خروج</Button>} />
  if (!store || store.status === 'draft') return <Wizard me={me} reload={reload} />

  const [tab, sub = ''] = hash.replace(/^#\/?/, '').split('/')
  const ctx = { me, store, reload, flash }
  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-28">
      <header className="flex items-center gap-3 px-5 pb-3 pt-5">
        <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-2xl text-[19px] font-black text-white" style={{ background: store.theme_color }}>
          {store.logo_path ? <img src={logoUrl(store.logo_path)} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : initial(store.name)}
        </span>
        <div className="min-w-0 flex-1"><p className="truncate text-[17px] font-extrabold leading-6">{store.name}</p><p className="text-[12px] text-mute">لوحة متجرك على <b className="font-extrabold text-brand">رزق</b></p></div>
        <button type="button" onClick={() => sb.auth.signOut()} className="min-h-11 rounded-2xl px-3 text-[13px] font-bold text-mute hover:bg-wash hover:text-ink">خروج</button>
      </header>
      <main className="px-5 pt-2">
        {store.status === 'suspended' && <p className="mb-5 rounded-2xl border-s-4 border-bad bg-[#fcefee] p-4 text-[15px]"><b>متجرك موقوف.</b> تواصل مع الإدارة. أرباحك محفوظة.</p>}
        {tab === 'products' ? <Products {...ctx} sub={sub} />
          : tab === 'orders' ? <Orders {...ctx} sub={sub} />
          : tab === 'money' ? <Earnings {...ctx} />
          : tab === 'more' ? <More {...ctx} sub={sub} />
          : <HomeTab {...ctx} />}
      </main>

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-40 px-4"><div role="status" className="rise mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink px-5 py-3.5 text-[15px] text-white shadow-[var(--shadow-lift)]">
          <span className="flex-1">{toast.text}</span>
          {toast.action && <button type="button" className="min-h-10 rounded-xl px-3 font-bold text-[#f3d27a]" onClick={() => { toast.action.run(); setToast(null) }}>{toast.action.label}</button>}
        </div></div>
      )}
      <InstallApp className="bottom-24" />
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t hairline bg-card/95 backdrop-blur safe-b" aria-label="التنقل">
        <ul className="mx-auto flex max-w-2xl px-2 pt-1.5">
          {TABS.map(([id, label, Icon]) => (
            <li key={id} className="flex-1">
              <a href={`#/${id}`} aria-current={tab === id ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[12px] transition ${tab === id ? 'font-bold text-ink' : 'font-medium text-mute'}`}>
                <Icon className="size-[22px]" strokeWidth={tab === id ? 2.25 : 1.75} aria-hidden="true" />{label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
