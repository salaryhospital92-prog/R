import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Store, LogIn, Loader2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

export default function Login() {
  const { session, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/dashboard" replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await signIn(email.trim(), password)
    if (error) {
      setError(
        error.message.includes('Invalid login')
          ? 'البريد أو كلمة المرور غير صحيحة'
          : 'تعذّر تسجيل الدخول: ' + error.message,
      )
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-6 text-center">
          <Store className="mx-auto size-10 text-brand-700" />
          <h1 className="mt-2 text-xl font-bold">أسواق الرفاعي</h1>
          <p className="text-sm text-ink-600">لوحة الإدارة والإدخال</p>
        </div>

        <label className="block text-sm font-semibold mb-1" htmlFor="email">البريد الإلكتروني</label>
        <input
          id="email" type="email" required dir="ltr" autoComplete="username"
          value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-ink-200 px-3 py-2 mb-4 text-start focus:border-brand-500 focus:outline-none"
        />

        <label className="block text-sm font-semibold mb-1" htmlFor="password">كلمة المرور</label>
        <input
          id="password" type="password" required autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-ink-200 px-3 py-2 mb-4 focus:border-brand-500 focus:outline-none"
        />

        {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-danger-700">{error}</p>}

        <button
          type="submit" disabled={busy}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-700 py-2.5 font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <LogIn className="size-5" />}
          دخول
        </button>
      </form>
    </div>
  )
}
