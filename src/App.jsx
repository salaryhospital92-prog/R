import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { hasStoredSession } from './lib/supabase'
import { CartProvider } from './context/CartContext'
import Home from './pages/storefront/Home'
import Catalog from './pages/storefront/Catalog'
import Checkout from './pages/storefront/Checkout'
import ProductPage from './pages/storefront/ProductPage'
import Login from './pages/dashboard/Login'
import Layout from './pages/dashboard/Layout'
import Products from './pages/dashboard/Products'
import ProductEditor from './pages/dashboard/ProductEditor'
import Orders from './pages/dashboard/Orders'
import Prices from './pages/dashboard/Prices'
import Zones from './pages/dashboard/Zones'
import Reports from './pages/dashboard/Reports'

// إخفاء الصفحات عن غير أصحابها تجربةُ استخدام؛ الحماية الحقيقية في RLS.
function ProtectedRoute({ children, adminOnly = false }) {
  const { session, profile, loading, isAdmin } = useAuth()

  // لا مؤشر دوّار لمن ليس مسجّلاً: تظهر شاشة الدخول فوراً.
  // العجلة تظهر فقط لمن لديه جلسة محفوظة يجري التحقق منها.
  if (loading) {
    if (!hasStoredSession()) return <Login />
    return <div className="flex min-h-dvh items-center justify-center"><Loader2 className="size-8 animate-spin text-brand-700" /></div>
  }
  if (!session) return <Navigate to="/dashboard/login" replace />
  if (!profile) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center text-ink-600">
        حسابك غير مرتبط بملف موظف. راجع المدير.
      </div>
    )
  }
  if (adminOnly && !isAdmin) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center text-ink-600">
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
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            {/* المتجر العام — بلا تسجيل دخول */}
            <Route path="/" element={<Home />} />
            <Route path="/retail" element={<Catalog mode="retail" />} />
            <Route path="/wholesale" element={<Catalog mode="wholesale" />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/p/:code" element={<ProductPage />} />

            {/* اللوحة */}
            <Route path="/dashboard/login" element={<Login />} />
            <Route path="/dashboard" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<Products />} />
              <Route path="product/:id" element={<ProductEditor />} />
              <Route path="orders"  element={<ProtectedRoute adminOnly><Orders /></ProtectedRoute>} />
              <Route path="prices"  element={<ProtectedRoute adminOnly><Prices /></ProtectedRoute>} />
              <Route path="zones"   element={<ProtectedRoute adminOnly><Zones /></ProtectedRoute>} />
              <Route path="reports" element={<ProtectedRoute adminOnly><Reports /></ProtectedRoute>} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  )
}
