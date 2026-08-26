import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom'
import {
  Package, LogOut, ShieldCheck, UserRound, ClipboardList, Tags, Truck, TrendingUp, Store,
  Bell, BellRing, X,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useOrderAlerts } from '../../hooks/useOrderAlerts'
import { formatIQD } from '../../lib/format'
import { asset } from '../../lib/store'

const NAV = [
  { to: '/dashboard',         label: 'المنتجات', icon: Package,       end: true },
  { to: '/dashboard/orders',  label: 'الطلبات',  icon: ClipboardList, admin: true },
  { to: '/dashboard/prices',  label: 'الأسعار',  icon: Tags,          admin: true },
  { to: '/dashboard/zones',   label: 'التوصيل',  icon: Truck,         admin: true },
  { to: '/dashboard/reports', label: 'التقارير', icon: TrendingUp,    admin: true },
]

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()
  const navigate = useNavigate()
  const { permission, requestPermission, lastOrder, dismiss } = useOrderAlerts(isAdmin)

  const link = ({ isActive }) =>
    `flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-bold transition ${
      isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
    }`

  return (
    <div className="min-h-dvh">
      <header className="glass sticky top-0 z-30">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 pt-3">
          <img src={asset('logo-mark.png')} alt="" className="size-9" />
          <span className="font-extrabold">أسواق الرفاعي</span>

          <span className="ms-auto flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1.5 text-[11px] font-bold ring-1 ring-slate-900/5">
            {isAdmin ? <ShieldCheck className="size-3.5 text-brand-600" /> : <UserRound className="size-3.5 text-slate-500" />}
            {profile?.full_name || (isAdmin ? 'مدير' : 'مدخل بيانات')}
          </span>
          {isAdmin && permission !== 'unsupported' && (
            <button
              onClick={requestPermission}
              title={permission === 'granted' ? 'التنبيهات مفعّلة' : 'تفعيل تنبيه الطلبات الجديدة'}
              className={`rounded-xl p-2 transition ${
                permission === 'granted' ? 'text-brand-600 hover:bg-brand-50' : 'text-slate-400 hover:bg-slate-100'
              }`}
              aria-label="تنبيهات الطلبات"
            >
              {permission === 'granted' ? <BellRing className="size-4.5" /> : <Bell className="size-4.5" />}
            </button>
          )}
          <Link to="/" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="عرض المتجر">
            <Store className="size-4.5" />
          </Link>
          <button onClick={signOut} className="rounded-xl p-2 text-red-600 hover:bg-red-50" aria-label="خروج">
            <LogOut className="size-4.5" />
          </button>
        </div>

        <nav className="no-scrollbar mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 py-2">
          {NAV.filter((n) => !n.admin || isAdmin).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={link}>
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* تنبيه داخل التطبيق يظهر فوراً عند وصول طلب جديد */}
      {lastOrder && (
        <button
          onClick={() => { dismiss(); navigate('/dashboard/orders') }}
          className="animate-rise fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md items-center gap-3 rounded-t-3xl bg-brand-600 p-4 text-start text-white shadow-2xl"
        >
          <BellRing className="size-6 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block font-extrabold">طلب جديد #{lastOrder.order_number}</span>
            <span className="block truncate text-sm text-white/85">
              {lastOrder.customer_name} — {formatIQD(lastOrder.total_amount)}
            </span>
          </span>
          <X className="size-5 shrink-0 opacity-70" onClick={(e) => { e.stopPropagation(); dismiss() }} />
        </button>
      )}

      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  )
}
