import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, Save, Check, Truck, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import ZadSettings from '../../components/ZadSettings'

/** مناطق التوصيل وأجورها — يعدّلها المدير بلا برمجة */
export default function Zones() {
  const [zones, setZones] = useState([])
  const [dirty, setDirty] = useState({})       // { id: {name, fee, is_active} }
  const [newZone, setNewZone] = useState({ name: '', fee: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const load = () =>
    supabase.from('delivery_zones').select('*').order('sort_order').then(({ data, error }) => {
      if (error) setError('تعذّر التحميل: ' + error.message)
      setZones(data ?? [])
      setLoading(false)
    })

  useEffect(() => { load() }, [])

  const val = (z, key) => dirty[z.id]?.[key] ?? z[key]

  const edit = (id, key, value) => {
    setSaved(false)
    setDirty((d) => ({ ...d, [id]: { ...d[id], [key]: value } }))
  }

  const save = async () => {
    setBusy(true); setError('')
    const updates = Object.entries(dirty).map(([id, v]) => {
      const z = zones.find((x) => String(x.id) === String(id))
      return {
        id: Number(id),
        name: (v.name ?? z.name).trim(),
        fee: Math.max(0, Number(String(v.fee ?? z.fee).replace(/\D/g, '')) || 0),
        sort_order: z.sort_order,
        is_active: v.is_active ?? z.is_active,
      }
    })
    const { error } = await supabase.from('delivery_zones').upsert(updates)
    if (error) setError('تعذّر الحفظ: ' + error.message)
    else { setDirty({}); setSaved(true); await load() }
    setBusy(false)
  }

  const add = async () => {
    if (!newZone.name.trim()) return setError('اكتب اسم المنطقة')
    setBusy(true); setError('')
    const { error } = await supabase.from('delivery_zones').insert({
      name: newZone.name.trim(),
      fee: Math.max(0, Number(newZone.fee.replace(/\D/g, '')) || 0),
      sort_order: (zones.at(-1)?.sort_order ?? 0) + 1,
    })
    if (error) setError(error.message.includes('duplicate') ? 'المنطقة موجودة مسبقاً' : 'تعذّرت الإضافة: ' + error.message)
    else { setNewZone({ name: '', fee: '' }); await load() }
    setBusy(false)
  }

  const remove = async (z) => {
    if (!confirm(`حذف منطقة «${z.name}»؟ الطلبات القديمة تحتفظ باسمها.`)) return
    const { error } = await supabase.from('delivery_zones').delete().eq('id', z.id)
    if (error) setError('تعذّر الحذف: ' + error.message)
    else await load()
  }

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="size-7 animate-spin text-brand-700" /></div>
  }

  const input = 'rounded-xl border border-ink-200 bg-white px-2.5 py-2 text-sm focus:border-brand-500 focus:outline-none'
  const count = Object.keys(dirty).length

  return (
    <div className="pb-24">
      <h1 className="mb-1 flex items-center gap-2 text-lg font-extrabold">
        <Truck className="size-5 text-brand-700" /> مناطق التوصيل
      </h1>
      <p className="mb-4 text-xs text-ink-600">
        الأجرة تُضاف لمجموع الطلب وتُقرأ من هنا — الزبون لا يستطيع تغييرها.
        أوقف منطقة بدل حذفها إن أردت إبقاءها في السجلات.
      </p>

      {error && <p className="mb-4 rounded-2xl bg-red-50 p-3 text-sm text-danger-700">{error}</p>}

      <div className="card mb-4 overflow-hidden">
        <div className="grid grid-cols-[1fr_6rem_5rem_2.5rem] gap-2 border-b border-ink-100 px-3 py-2.5 text-[11px] font-bold text-ink-600">
          <span>المنطقة</span><span className="text-center">الأجرة (د.ع)</span><span className="text-center">مفعّلة</span><span />
        </div>

        {zones.map((z) => (
          <div key={z.id} className="grid grid-cols-[1fr_6rem_5rem_2.5rem] items-center gap-2 border-b border-slate-50 px-3 py-2 last:border-0">
            <input value={val(z, 'name')} onChange={(e) => edit(z.id, 'name', e.target.value)} className={input + ' w-full'} />
            <input inputMode="numeric" value={String(val(z, 'fee'))}
                   onChange={(e) => edit(z.id, 'fee', e.target.value.replace(/\D/g, ''))}
                   className={input + ' w-full text-center'} />
            <label className="flex justify-center">
              <input type="checkbox" checked={Boolean(val(z, 'is_active'))}
                     onChange={(e) => edit(z.id, 'is_active', e.target.checked)}
                     className="size-5 accent-emerald-600" />
            </label>
            <button onClick={() => remove(z)} className="rounded-lg p-2 text-danger-700 hover:bg-red-50" aria-label="حذف">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="card p-3">
        <p className="mb-2 text-sm font-bold">إضافة منطقة</p>
        <div className="flex flex-wrap gap-2">
          <input value={newZone.name} onChange={(e) => setNewZone({ ...newZone, name: e.target.value })}
                 placeholder="اسم المنطقة" className={input + ' min-w-40 flex-1'} />
          <input inputMode="numeric" value={newZone.fee}
                 onChange={(e) => setNewZone({ ...newZone, fee: e.target.value.replace(/\D/g, '') })}
                 placeholder="الأجرة" className={input + ' w-28 text-center'} />
          <button onClick={add} disabled={busy}
                  className="flex items-center gap-1.5 rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            <Plus className="size-4" /> إضافة
          </button>
        </div>
      </div>

      <TelegramSettings />
      <ZadSettings onSynced={load} />

      {(count > 0 || saved) && (
        <div className="glass fixed inset-x-0 bottom-0 z-30 p-3">
          <button onClick={save} disabled={busy || count === 0}
                  className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-2xl bg-brand-700 py-3.5 font-bold text-white disabled:opacity-60">
            {busy ? <Loader2 className="size-5 animate-spin" />
              : saved && count === 0 ? <Check className="size-5" /> : <Save className="size-5" />}
            {saved && count === 0 ? 'تم الحفظ' : `حفظ ${count} منطقة`}
          </button>
        </div>
      )}
    </div>
  )
}


/** إعدادات إشعار التيليغرام — قاعدة البيانات ترسل الإشعار عند كل طلب جديد */
function TelegramSettings() {
  const [values, setValues] = useState({ telegram_bot_token: '', telegram_chat_id: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.from('app_settings').select('key, value').then(({ data }) => {
      const map = {}
      ;(data ?? []).forEach((r) => { map[r.key] = r.value })
      setValues((v) => ({ ...v, ...map }))
    })
  }, [])

  const save = async () => {
    setBusy(true); setMsg('')
    const { error } = await supabase.from('app_settings').upsert(
      Object.entries(values).map(([key, value]) => ({ key, value: value.trim(), updated_at: new Date().toISOString() })),
    )
    setMsg(error ? 'تعذّر الحفظ: ' + error.message : 'تم الحفظ — جرّب طلباً من المتجر ليصلك إشعار.')
    setBusy(false)
  }

  const input = 'w-full rounded-xl border border-ink-200 bg-white px-2.5 py-2 text-sm focus:border-brand-500 focus:outline-none'

  return (
    <section className="card mt-4 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-extrabold">
        <Send className="size-4 text-brand-700" /> إشعار التيليغرام عند كل طلب
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-ink-600">
        1) افتح <span className="font-bold" dir="ltr">@BotFather</span> في تيليغرام واكتب <span dir="ltr">/newbot</span> وانسخ التوكن.
        <br />
        2) أرسل رسالة لبوتك، ثم افتح <span className="font-bold" dir="ltr">@userinfobot</span> لتعرف معرّف محادثتك.
        <br />
        3) الصق القيمتين هنا واحفظ.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-bold text-ink-600">
          توكن البوت
          <input dir="ltr" type="password" value={values.telegram_bot_token}
                 onChange={(e) => setValues({ ...values, telegram_bot_token: e.target.value })}
                 placeholder="123456:ABC-DEF…" className={input + ' mt-1 text-start'} />
        </label>
        <label className="text-xs font-bold text-ink-600">
          معرّف المحادثة
          <input dir="ltr" value={values.telegram_chat_id}
                 onChange={(e) => setValues({ ...values, telegram_chat_id: e.target.value })}
                 placeholder="123456789" className={input + ' mt-1 text-start'} />
        </label>
      </div>

      <button onClick={save} disabled={busy}
              className="mt-3 flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} حفظ الإعدادات
      </button>

      {msg && <p className="mt-2 text-xs text-ink-600">{msg}</p>}
    </section>
  )
}
