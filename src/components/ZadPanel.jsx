import { useCallback, useEffect, useState } from 'react'
import { Bike, Loader2, Phone, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatIQD } from '../lib/format'

const ACTIVE = ['searching', 'assigned', 'picked_up', 'on_hold']
const LABEL = {
  searching: 'يبحث عن كابتن…',
  assigned: 'الكابتن بالطريق للمحل',
  picked_up: 'استلم الكابتن الطلب وهو بالطريق للزبون',
  delivered: 'سُلِّم للزبون',
  failed: 'فشل التسليم — اتصل بالزبون',
  cancelled: 'أُلغي الاستدعاء',
  on_hold: 'عند دعم زاد — لا إجراء منك',
}

/**
 * استدعاء كابتن زاد لطلب مؤكَّد وجاهز، ومتابعة رحلته.
 * الكابتن يدفع ثمن البضاعة عند المحل ويحصّله من الزبون مع أجرة التوصيل.
 */
export default function ZadPanel({ order }) {
  const [dv, setDv] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('zad_deliveries').select('*')
      .eq('order_id', order.id).order('created_at', { ascending: false }).limit(1)
    setDv(data?.[0] ?? null)
  }, [order.id])

  useEffect(() => { load() }, [load])

  // ما دامت الرحلة مفتوحة نعيد القراءة؛ الخادم يتابع زاد كل دقيقة
  const active = dv && ACTIVE.includes(dv.status)
  useEffect(() => {
    if (!active) return undefined
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [active, load])

  const dispatch = async () => {
    const goods = order.total_amount - order.delivery_fee
    const ok = window.confirm(
      `استدعاء كابتن زاد للطلب #${order.order_number}؟\n\n` +
      `يدفع الكابتن ثمن البضاعة ${formatIQD(goods)} عند المحل،\n` +
      'ويحصّل من الزبون البضاعة + أجرة زاد.')
    if (!ok) return
    setBusy('dispatch'); setError('')
    const { error } = await supabase.rpc('zad_dispatch', { p_order_id: order.id })
    if (error) setError(error.message)
    await load()
    setBusy('')
  }

  const cancel = async () => {
    if (!window.confirm('إلغاء استدعاء الكابتن؟')) return
    setBusy('cancel'); setError('')
    const { error } = await supabase.rpc('zad_cancel', { p_order_id: order.id })
    if (error) setError(error.message)
    await load()
    setBusy('')
  }

  const canCall = order.status === 'confirmed' && !active
  if (!dv && !canCall) return null

  return (
    <div className="mb-3 rounded-2xl border border-ink-200 bg-ink-50 p-3 text-sm">
      <p className="mb-2 flex items-center gap-2 font-extrabold text-ink-900">
        <Bike className="size-4 text-brand-700" /> كابتن زاد
        {dv?.mode === 'test' && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-warn-600">تجريبي</span>
        )}
      </p>

      {dv && (
        <div className="mb-2 grid gap-1">
          <p className="font-bold">{LABEL[dv.status] ?? dv.status}
            {dv.status === 'cancelled' && dv.cancel_reason === 'no_rider_found' && ' — لم يقبله كابتن خلال ساعة'}
          </p>
          {dv.summon_number && (
            <p className="text-ink-700">رقم الاستدعاء (يقوله الكابتن عند الكاونتر):{' '}
              <b className="tnum text-lg text-ink-900">{dv.summon_number}</b></p>
          )}
          {dv.captain?.name && (
            <p className="flex flex-wrap items-center gap-2 text-ink-700">
              {dv.captain.name}
              {dv.captain.phone && (
                <a href={`tel:+${dv.captain.phone}`} dir="ltr"
                   className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-white px-2 font-bold text-ink-900 ring-1 ring-ink-200">
                  <Phone className="size-3.5" /> {dv.captain.phone}
                </a>
              )}
            </p>
          )}
          <p className="text-xs text-ink-600">
            يحصّل من الزبون: البضاعة {formatIQD(dv.cash_to_collect)} + أجرة التوصيل {formatIQD(dv.delivery_fee)}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canCall && (
          <button type="button" onClick={dispatch} disabled={Boolean(busy)}
                  className="flex min-h-10 items-center gap-2 rounded-xl bg-brand-700 px-4 py-2 font-bold text-white disabled:opacity-60">
            {busy === 'dispatch' ? <Loader2 className="size-4 animate-spin" /> : <Bike className="size-4" />}
            {dv ? 'استدعاء كابتن من جديد' : 'استدعاء كابتن زاد'}
          </button>
        )}
        {dv?.status === 'searching' && (
          <button type="button" onClick={cancel} disabled={Boolean(busy)}
                  className="flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 py-2 font-bold text-danger-700 ring-1 ring-ink-200 disabled:opacity-60">
            {busy === 'cancel' ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} إلغاء الاستدعاء
          </button>
        )}
      </div>

      {error && <p role="alert" className="mt-2 text-xs font-bold text-danger-700">{error}</p>}
    </div>
  )
}
