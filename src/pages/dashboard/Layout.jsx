import { NavLink, Outlet } from 'react-router-dom'
import { Store, Package, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

export default function Layout() {
  const { profile, isAdmin, signOut } = useAuth()

  const link = ({ isActive }) =>
    `flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
      isActive ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'
    }`

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 p-3">
          <Store className="size-6 shrink-0 text-emerald-600" />
          <span className="font-bold">أسواق الرفاعي</span>

          <nav className="flex gap-1 overflow-x-auto">
            <NavLink to="/dashboard" end className={link}>
              <Package className="size-4" /> المنتجات
            </NavLink>
          </nav>

          <div className="ms-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs sm:flex">
              {isAdmin ? <ShieldCheck className="size-4 text-emerald-600" /> : <UserRound className="size-4 text-slate-500" />}
              {profile?.full_name || (isAdmin ? 'مدير' : 'مدخل بيانات')}
            </span>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              <LogOut className="size-4" /> خروج
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  )
}
