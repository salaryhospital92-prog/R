import { Store } from 'lucide-react'

// المرحلة 1: أساس المشروع فقط. المتجر واللوحة والتوجيه (Router) في المرحلة 2.
export default function App() {
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-3 p-6 text-center">
      <Store className="size-10 text-emerald-600" />
      <h1 className="text-2xl font-bold">أسواق الرفاعي</h1>
      <p className="text-slate-600">الرمادي – شارع السينما – فرع الشورجة</p>
      <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-2 text-emerald-800">
        الأساس جاهز ✓ — بانتظار المرحلة الثانية
      </p>
    </main>
  )
}
