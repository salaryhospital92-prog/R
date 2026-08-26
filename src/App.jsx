import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CartProvider } from './context/CartContext'
import ModeSelect from './pages/storefront/ModeSelect'
import Catalog from './pages/storefront/Catalog'
import Checkout from './pages/storefront/Checkout'
import Login from './pages/dashboard/Login'
import Layout from './pages/dashboard/Layout'
import Products from './pages/dashboard/Products'
import ProductEditor from './pages/dashboard/ProductEditor'

// إخفاء الصفحات عن غير أصحابها تجربةُ استخدام؛ الحماية الحقيقية في RLS.
function ProtectedRoute({ children, adminOnly = false }) {
  const { session, profile, loading, isAdmin } = useAuth()

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center"><Loader2 className="size-8 animate-spin text-brand-600" /></div>
  }
  if (!session) return <Navigate to="/dashboard/login" replace />
  if (!profile) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center text-slate-600">
        حسابك غير مرتبط بملف موظف. راجع المدير.
      </div>
    )
  }
  if (adminOnly && !isAdmin) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center text-slate-600">
        هذه الصفحة للمدير فقط.
      </div>
    )
  }
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <BrowserRouter>
          <Routes>
            {/* المتجر العام — بلا تسجيل دخول */}
            <Route path="/" element={<ModeSelect />} />
            <Route path="/retail" element={<Catalog mode="retail" />} />
            <Route path="/wholesale" element={<Catalog mode="wholesale" />} />
            <Route path="/checkout" element={<Checkout />} />

            {/* اللوحة */}
            <Route path="/dashboard/login" element={<Login />} />
            <Route path="/dashboard" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<Products />} />
              <Route path="product/:id" element={<ProductEditor />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  )
}
