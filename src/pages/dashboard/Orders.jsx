import { useCallback, useEffect, useState } from 'react'
import {
  Loader2, Phone, MapPin, ChevronDown, Package, MessageCircle, AlertTriangle, Tag,
  ExternalLink,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatIQD, formatNumber } from '../../lib/format'
import ZadPanel from '../../components/ZadPanel'

const STATUS = {
  new:       { label: 'جديد',   cls: 'bg-blue-50 text-blue-700 ring-blue-600/15' },
  confirmed: { label: 'مؤكد',   cls: 'bg-amber-50 text-warn-600 ring-amber-600/15' },
  delivered: { label: 'مُسلَّم', cls: 'bg-brand-50 text-brand-700 ring-brand-600/15' },
  cancelled: { label: 'ملغى',   cls: 'bg-red-50 text-danger-700 ring-red-600/15' },
}

export default function Orders() {
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState('')
  const [openId, setOpenId] = useState(null)
  const [priceDraft, setPriceDraft] = useState({})   // { `${orderId}:${productId}`: value }
  const [pricing, setPricing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders').select('*').neq('source', 'mona').order('created_at', { ascending: false }).limit(300)
    if (error) setError('تعذّر تحميل الطلبات: ' + error.message)
    setOrders(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const changeStatus = async (order, status) => {
    setError('')
    const { error } = await supabase.from('orders').update({ status }).eq('id', order.id)
    if (error) return setError('تعذّر تغيير الحالة: ' + error.message)
    // الإلغاء يعيد الكمية للمخزون وإعادة التفعيل تخصمها — يتم في قاعدة البيانات
    setOrders((list) => list.map((o) => (o.id === order.id ? { ...o, status } : o)))
  }

  // تسعير بند بلا سعر: القاعدة تعيد حساب المجاميع، لا المتصفح
  const priceItem = async (order, item, saveToProduct) => {
    const key = `${order.id}:${item.product_id}`
    const value = Math.max(0, Number(priceDraft[key]) || 0)
    if (value <= 0) return setError('أدخل سعراً أكبر من صفر')
    setPricing(key)
    setError('')
    const { data, error } = await supabase.rpc('price_order_item', {
      p_order_id: order.id,
      p_product_id: item.product_id,
      p_unit_price: value,
      p_save_to_product: saveToProduct,
    })
    if (error) setError('تعذّر التسعير: ' + error.message)
    else {
      setOrders((list) => list.map((o) => o.id === order.id
        ? { ...o, items_json: data.items, subtotal: data.subtotal, total_amount: data.total_amount }
        : o))
      setPriceDraft((d) => ({ ...d, [key]: '' }))
    }
    setPricing(null)
  }

  const shown = filter ? orders.filter((o) => o.status === filter) : orders
  const active = orders.filter((o) => o.status !== 'cancelled')
  const today = new Date().toISOString().slice(0, 10)
  const salesToday = active.filter((o) => o.created_at.startsWith(today))
    .reduce((s, o) => s + o.total_amount, 0)
  const newCount = orders.filter((o) => o.status === 'new').length

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="size-7 animate-spin text-brand-700" /></div>
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="طلبات جديدة" value={formatNumber(newCount)} tone="text-blue-700" />
        <Stat label="مبيعات اليوم" value={formatIQD(salesToday)} tone="text-brand-700" />
        <Stat label="كل الطلبات" value={formatNumber(orders.length)} tone="text-ink-700" />
      </div>

      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
        {[{ k: '', l: 'الكل' }, ...Object.entries(STATUS).map(([k, v]) => ({ k, l: v.label }))].map((f) => (
          <button
            key={f.k || 'all'} onClick={() => setFilter(f.k)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-bold transition ${
              filter === f.k ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-900/8'
            }`}
          >
            {f.l}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 rounded-2xl bg-red-50 p-3 text-sm text-danger-700">{error}</p>}

      {shown.length === 0 ? (
        <div className="card p-12 text-center text-ink-600">
          <Package className="mx-auto mb-3 size-9 text-ink-200" />
          لا توجد طلبات في هذه الحالة.
        </div>
      ) : (
        <ul className="grid gap-2">
          {shown.map((o) => {
            const open = openId === o.id
            const hasAsk = (o.items_json ?? []).some((i) => i.price_on_request)
            return (
              <li key={o.id} className="card overflow-hidden">
                <button
                  onClick={() => setOpenId(open ? null : o.id)}
                  className="flex w-full items-center gap-3 p-3.5 text-start"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-extrabold">#{o.order_number}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${STATUS[o.status].cls}`}>
                        {STATUS[o.status].label}
                      </span>
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-bold text-ink-600">
                        {o.mode === 'wholesale' ? 'جملة' : 'مفرد'}
                      </span>
                      {hasAsk && <AlertTriangle className="size-4 text-amber-500" />}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-ink-600">{o.customer_name}</span>
                    <span className="block text-xs text-ink-600">
                      {new Date(o.created_at).toLocaleString('ar-IQ-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </span>
                  <span className="shrink-0 text-end">
                    <span className="block font-extrabold text-brand-700">{formatIQD(o.total_amount)}</span>
                    <ChevronDown className={`ms-auto mt-1 size-4 text-ink-600 transition ${open ? 'rotate-180' : ''}`} />
                  </span>
                </button>

                {open && (
                  <div className="animate-fade-up border-t border-ink-100 p-3.5 text-sm">
                    <div className="mb-3 grid gap-2">
                      <a href={`tel:${o.customer_phone}`} className="flex items-center gap-2 text-ink-700">
                        <Phone className="size-4 text-ink-600" />
                        <span dir="ltr" className="font-bold">{o.customer_phone}</span>
                      </a>
                      <p className="flex items-center gap-2 text-ink-700">
                        <MapPin className="size-4 text-ink-600" /> {o.delivery_zone}
                      </p>
                      {o.customer_note && (
                        <p className="rounded-xl bg-ink-50 p-2 text-xs text-ink-600">{o.customer_note}</p>
                      )}
                    </div>

                    <ZadPanel order={o} onChanged={load} />

                    <ul className="mb-3 grid gap-2">
                      {(o.items_json ?? []).map((it, i) => {
                        const key = `${o.id}:${it.product_id}`
                        const byDozen = o.mode === 'wholesale' && it.qty % 12 === 0
                        return (
                          <li key={i}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 flex-1 truncate">
                                {it.name}
                                <span className="text-ink-600">
                                  {' '}× {byDozen ? `${formatNumber(it.qty / 12)} درزن` : `${formatNumber(it.qty)} قطعة`}
                                </span>
                              </span>
                              <span className={it.price_on_request ? 'font-bold text-warn-600' : 'font-bold'}>
                                {it.price_on_request ? 'يُحدَّد عند التأكيد' : formatIQD(it.line_total)}
                              </span>
                            </div>

                            {/* هوية البند: أسماء كثيرة متطابقة، والرمز والباركود يفصلان بينها */}
                            {it.code && (
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                                <a
                                  href={`/p/${it.code}`} target="_blank" rel="noreferrer"
                                  className="inline-flex min-h-6 items-center gap-1 rounded-lg bg-ink-900 px-2 py-1 font-extrabold text-white"
                                >
                                  <ExternalLink className="size-3" /> {it.code}
                                </a>
                                {it.barcode && (
                                  <span className="rounded-lg bg-ink-100 px-2 py-1 font-bold tabular-nums text-ink-700">
                                    {it.barcode}
                                  </span>
                                )}
                              </div>
                            )}

                            {it.price_on_request && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-2">
                                <Tag className="size-4 shrink-0 text-warn-600" />
                                <input
                                  inputMode="numeric" placeholder="سعر القطعة"
                                  value={priceDraft[key] ?? ''}
                                  onChange={(e) => setPriceDraft((d) => ({ ...d, [key]: e.target.value.replace(/\D/g, '') }))}
                                  className="w-28 rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-center text-sm font-bold focus:border-amber-500 focus:outline-none"
                                />
                                <span className="text-xs text-warn-600">
                                  × {formatNumber(it.qty)} = {formatIQD((Number(priceDraft[key]) || 0) * it.qty)}
                                </span>
                                <button
                                  type="button" disabled={pricing === key}
                                  onClick={() => priceItem(o, it, false)}
                                  className="rounded-lg bg-warn-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
                                >
                                  {pricing === key ? '…' : 'تسعير الطلب'}
                                </button>
                                <button
                                  type="button" disabled={pricing === key}
                                  onClick={() => priceItem(o, it, true)}
                                  className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
                                >
                                  تسعير + اعتماده للمنتج
                                </button>
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>

                    <div className="mb-3 border-t border-ink-100 pt-2 text-ink-600">
                      <Line label="البضاعة" value={formatIQD(o.subtotal)} />
                      <Line label={`التوصيل — ${o.delivery_zone}`} value={formatIQD(o.delivery_fee)} />
                      <Line label="المجموع" value={formatIQD(o.total_amount)} bold />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {Object.entries(STATUS).map(([k, v]) => (
                        <button
                          key={k} onClick={() => changeStatus(o, k)} disabled={o.status === k}
                          className={`rounded-xl px-3 py-2 text-xs font-bold transition ${
                            o.status === k ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'
                          }`}
                        >
                          {v.label}
                        </button>
                      ))}
                      <a
                        href={`https://wa.me/${o.customer_phone.replace(/^0/, '964').replace(/\D/g, '')}`}
                        target="_blank" rel="noopener noreferrer"
                        className="ms-auto flex items-center gap-1.5 rounded-xl bg-brand-700 px-3 py-2 text-xs font-bold text-white"
                      >
                        <MessageCircle className="size-4" /> مراسلة الزبون
                      </a>
                    </div>

                    <p className="mt-2 text-[11px] text-ink-600">
                      الإلغاء يُعيد الكميات للمخزون تلقائياً، وإعادة التفعيل تخصمها من جديد.
                    </p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="card p-3 text-center">
      <p className="text-[11px] text-ink-600">{label}</p>
      <p className={`mt-0.5 text-sm font-extrabold ${tone}`}>{value}</p>
    </div>
  )
}

function Line({ label, value, bold }) {
  return (
    <div className={`flex justify-between py-0.5 ${bold ? 'font-extrabold text-ink-900' : ''}`}>
      <span className="truncate">{label}</span>
      <span className="shrink-0">{value}</span>
    </div>
  )
}
