import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, TrendingUp, PackageX, Trophy, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatIQD, formatNumber } from '../../lib/format'

const PERIODS = [
  { k: 'today', l: 'اليوم', days: 0 },
  { k: 'week',  l: '7 أيام', days: 7 },
  { k: 'month', l: '30 يوم', days: 30 },
  { k: 'all',   l: 'الكل',  days: null },
]

export default function Reports() {
  // وقت الفتح يُثبَّت مرة واحدة حتى لا تتغيّر حدود الفترة بين إعادات الرسم
  const [now] = useState(() => Date.now())
  const [orders, setOrders] = useState([])
  const [lowStock, setLowStock] = useState([])
  const [period, setPeriod] = useState('month')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      supabase.from('orders').select('total_amount, subtotal, delivery_fee, status, mode, items_json, created_at')
        .neq('status', 'cancelled').order('created_at', { ascending: false }).limit(1000),
      supabase.from('products').select('id, name, quantity_single, categories(name)')
        .eq('is_active', true).lte('quantity_single', 12).order('quantity_single'),
    ]).then(([o, p]) => {
      if (o.error) setError('تعذّر تحميل التقارير: ' + o.error.message)
      setOrders(o.data ?? [])
      setLowStock(p.data ?? [])
      setLoading(false)
    })
  }, [])

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="size-7 animate-spin text-brand-700" /></div>
  }

  const days = PERIODS.find((p) => p.k === period).days
  const since = days === null ? null
    : new Date(now - Math.max(days, 0) * 864e5).toISOString().slice(0, 10)
  const inRange = orders.filter((o) =>
    since === null ? true
      : days === 0 ? o.created_at.startsWith(new Date(now).toISOString().slice(0, 10))
      : o.created_at.slice(0, 10) >= since)

  const revenue = inRange.reduce((s, o) => s + o.subtotal, 0)
  const delivery = inRange.reduce((s, o) => s + o.delivery_fee, 0)
  const wholesale = inRange.filter((o) => o.mode === 'wholesale').length

  // أكثر المنتجات مبيعاً في الفترة
  const sold = {}
  inRange.forEach((o) => (o.items_json ?? []).forEach((it) => {
    sold[it.name] = (sold[it.name] ?? 0) + it.qty
  }))
  const top = Object.entries(sold).sort((a, b) => b[1] - a[1]).slice(0, 8)

  return (
    <div>
      <h1 className="mb-3 flex items-center gap-2 text-lg font-extrabold">
        <TrendingUp className="size-5 text-brand-700" /> التقارير
      </h1>

      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
        {PERIODS.map((p) => (
          <button
            key={p.k} onClick={() => setPeriod(p.k)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-bold transition ${
              period === p.k ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-900/8'
            }`}
          >
            {p.l}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 rounded-2xl bg-red-50 p-3 text-sm text-danger-700">{error}</p>}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={<Wallet className="size-4" />} label="مبيعات البضاعة" value={formatIQD(revenue)} tone="text-brand-700" />
        <Stat label="أجور التوصيل" value={formatIQD(delivery)} tone="text-ink-700" />
        <Stat label="عدد الطلبات" value={formatNumber(inRange.length)} tone="text-blue-700" />
        <Stat label="منها جملة" value={formatNumber(wholesale)} tone="text-warn-600" />
      </div>

      <section className="card mb-4 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold">
          <Trophy className="size-4 text-amber-500" /> الأكثر مبيعاً
        </h2>
        {top.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-600">لا مبيعات في هذه الفترة.</p>
        ) : (
          <ul className="grid gap-2">
            {top.map(([name, qty], i) => (
              <li key={name} className="flex items-center gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-[11px] font-extrabold text-ink-600">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                <span className="shrink-0 text-sm font-extrabold text-brand-700">{formatNumber(qty)} قطعة</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-extrabold">
          <PackageX className="size-4 text-red-500" /> نواقص المخزون
        </h2>
        <p className="mb-3 text-xs text-ink-600">المنتجات التي بقي منها درزن واحد أو أقل (12 قطعة).</p>

        {lowStock.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-600">لا توجد نواقص — المخزون بخير.</p>
        ) : (
          <ul className="grid gap-1.5">
            {lowStock.map((p) => (
              <li key={p.id}>
                <Link to={`/dashboard/product/${p.id}`} className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-ink-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{p.name}</span>
                    <span className="block text-[11px] text-ink-600">{p.categories?.name}</span>
                  </span>
                  <span className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-extrabold ${
                    p.quantity_single === 0 ? 'bg-red-50 text-danger-700' : 'bg-amber-50 text-warn-600'
                  }`}>
                    {p.quantity_single === 0 ? 'نفد' : `${formatNumber(p.quantity_single)} قطعة`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ icon, label, value, tone }) {
  return (
    <div className="card p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-ink-600">{icon}{label}</p>
      <p className={`mt-1 text-sm font-extrabold ${tone}`}>{value}</p>
    </div>
  )
}
