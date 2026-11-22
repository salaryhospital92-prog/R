import { useCallback, useEffect, useState } from 'react'
import { Loader2, Phone, MapPin, RefreshCw, ExternalLink, PackageCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatIQD, formatNumber } from '../../lib/format'
import ZadPanel from '../../components/ZadPanel'

/**
 * شاشة التجهيز — للمشرف والمدير: الطلبات الجديدة والمؤكَّدة، تأكيدٌ واستدعاء كابتن بضغطة.
 * لا تسعير ولا إلغاء ولا تعديل هنا؛ المشرف يؤكّد ويستدعي فقط (تفرضه قاعدة البيانات لا الواجهة).
 */
export default function Dispatch() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('orders').select('*')
      .in('status', ['new', 'confirmed']).neq('source', 'mona')
      .order('created_at', { ascending: false }).limit(50)
    if (error) setError('تعذّر تحميل الطلبات: ' + error.message)
    else setError('')
    setOrders(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="size-7 animate-spin text-brand-700" /></div>
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-extrabold">
          <PackageCheck className="size-5 text-brand-700" /> التجهيز
        </h1>
        <button type="button" onClick={load}
                className="flex min-h-10 items-center gap-1.5 rounded-xl bg-ink-100 px-3 text-sm font-bold text-ink-900">
          <RefreshCw className="size-4" /> تحديث
        </button>
      </div>

      {error && <p role="alert" className="mb-3 rounded-2xl bg-red-50 p-3 text-sm text-danger-700">{error}</p>}

      {orders.length === 0 ? (
        <p className="surface p-10 text-center text-sm text-ink-600">لا طلبات بانتظار التجهيز.</p>
      ) : (
        <ul className="grid gap-3">
          {orders.map((o) => (
            <li key={o.id} className="surface-raised p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-extrabold">
                  طلب <span className="tnum">#{o.order_number}</span>
                  <span className={`ms-2 rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                    o.status === 'new' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-warn-600'}`}>
                    {o.status === 'new' ? 'جديد' : 'مؤكَّد'}
                  </span>
                </p>
                <p className="text-xs text-ink-600">
                  {new Date(o.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                </p>
              </div>

              <div className="mb-3 grid gap-1 text-sm">
                <p className="font-bold">{o.customer_name}</p>
                <a href={`tel:${o.customer_phone}`} dir="ltr"
                   className="inline-flex min-h-8 w-fit items-center gap-1.5 font-bold text-ink-800">
                  <Phone className="size-4 text-ink-600" /> {o.customer_phone}
                </a>
                <p className="flex items-center gap-1.5 text-ink-700">
                  <MapPin className="size-4 text-ink-600" /> {o.delivery_zone}
                </p>
                {o.customer_note && <p className="rounded-xl bg-ink-50 p-2 text-xs text-ink-700">{o.customer_note}</p>}
              </div>

              <ul className="mb-3 grid gap-2">
                {(o.items_json ?? []).map((it, i) => (
                  <li key={i} className="rounded-xl bg-ink-50 p-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="min-w-0 flex-1">
                        {it.name}
                        <span className="text-ink-600">
                          {' '}× {o.mode === 'wholesale' && it.qty % 12 === 0
                            ? `${formatNumber(it.qty / 12)} درزن` : `${formatNumber(it.qty)} قطعة`}
                        </span>
                      </span>
                      <span className="font-bold">
                        {it.price_on_request ? 'عند الطلب' : formatIQD(it.line_total)}
                      </span>
                    </div>
                    {it.code && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <a href={`/p/${it.code}`} target="_blank" rel="noreferrer"
                           className="inline-flex min-h-6 items-center gap-1 rounded-lg bg-ink-900 px-2 py-1 font-extrabold text-white">
                          <ExternalLink className="size-3" /> {it.code}
                        </a>
                        {it.barcode && (
                          <span className="rounded-lg bg-white px-2 py-1 font-bold tabular-nums text-ink-700">{it.barcode}</span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <div className="mb-3 flex items-center justify-between border-t border-ink-200 pt-2 text-sm">
                <span className="text-ink-600">المجموع (بضاعة + توصيل)</span>
                <b className="text-brand-800">{formatIQD(o.total_amount)}</b>
              </div>

              <ZadPanel order={o} onChanged={load} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
