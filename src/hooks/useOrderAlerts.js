import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatIQD } from '../lib/format'
import { asset } from '../lib/store'

/** نغمة تنبيه قصيرة بلا ملف صوتي */
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.12)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45)
    osc.start(); osc.stop(ctx.currentTime + 0.5)
    setTimeout(() => ctx.close(), 800)
  } catch { /* الصوت ليس ضرورياً */ }
}

const supported = typeof Notification !== 'undefined'

/**
 * تنبيه المدير بالطلبات الجديدة لحظياً عبر Supabase Realtime.
 * يعمل ما دام التطبيق مفتوحاً (أو في الخلفية على أندرويد).
 * الإشعار المضمون وقت إغلاق التطبيق هو إشعار التيليغرام من قاعدة البيانات.
 */
export function useOrderAlerts(enabled) {
  const [permission, setPermission] = useState(supported ? Notification.permission : 'unsupported')
  const [lastOrder, setLastOrder] = useState(null)

  const requestPermission = useCallback(async () => {
    if (!supported) return
    const p = await Notification.requestPermission()
    setPermission(p)
    if (p === 'granted') beep()
  }, [])

  useEffect(() => {
    if (!enabled) return

    const channel = supabase
      .channel('orders-alerts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, ({ new: o }) => {
        if (o.source === 'mona') return // طلبات المنى لها لوحتها الخاصة
        setLastOrder(o)
        beep()
        if (supported && Notification.permission === 'granted') {
          const n = new Notification(`طلب جديد #${o.order_number}`, {
            body: `${o.customer_name} — ${formatIQD(o.total_amount)}\n${o.delivery_zone ?? ''}`,
            icon: asset('icon-192.png'),
            badge: asset('icon-192.png'),
            tag: `order-${o.order_number}`,
            dir: 'rtl',
            lang: 'ar',
          })
          n.onclick = () => { window.focus(); window.location.href = `${import.meta.env.BASE_URL}dashboard/orders` }
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [enabled])

  return { permission, requestPermission, lastOrder, dismiss: () => setLastOrder(null) }
}
