import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    const load = async (s) => {
      if (!alive) return
      setSession(s)
      if (!s) {
        setProfile(null)
        setLoading(false)
        return
      }
      // الدور يُقرأ من قاعدة البيانات لا من الجلسة — لا يمكن تزويره من المتصفح
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', s.user.id)
        .maybeSingle()
      if (!alive) return
      setProfile(data)
      setLoading(false)
    }

    supabase.auth.getSession().then(({ data }) => load(data.session))

    // استدعاء supabase داخل onAuthStateChange مباشرةً يسبّب تجمّداً معروفاً في
    // supabase-js v2 — التأجيل بـ setTimeout يخرجنا من سياق القفل.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setTimeout(() => load(s), 0)
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = {
    session,
    profile,
    loading,
    isAdmin: profile?.role === 'admin',
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
