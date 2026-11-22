import { useEffect, useState } from 'react'
import { Loader2, Save, RefreshCw, Bike, ShieldCheck, Power } from 'lucide-react'
import { supabase } from '../lib/supabase'

function Btn({ onClick, busy, name, icon: Icon, children, dark }) {
  return (
    <button type="button" onClick={onClick} disabled={Boolean(busy)}
            className={`flex min-h-10 items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-60 ${
              dark ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-900'}`}>
      {busy === name ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />} {children}
    </button>
  )
}

/**
 * إعداد الربط مع شركة التوصيل «زاد» — في صفحة المناطق.
 * المفتاحان يُكتبان هنا ويُحفظان في جدول لا يقرؤه المتصفح إطلاقاً؛
 * فلا يظهر السرّ في الصفحة بعد الحفظ ولا يخرج من قاعدة البيانات.
 */
export default function ZadSettings({ onSynced }) {
  const [st, setSt] = useState(null)
  const [keys, setKeys] = useState({ id: '', secret: '' })
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState({ text: '', bad: false })

  const refresh = () => supabase.rpc('zad_status').then(({ data }) => setSt(data))
  useEffect(() => { refresh() }, [])

  const run = async (name, fn, ok) => {
    setBusy(name); setMsg({ text: '', bad: false })
    const { data, error } = await fn()
    if (error) setMsg({ text: error.message, bad: true })
    else setMsg({ text: ok(data), bad: false })
    await refresh()
    setBusy('')
    return { data, error }
  }

  const saveKeys = async () => {
    const { error } = await run('save',
      () => supabase.rpc('zad_save_credentials', { p_client_id: keys.id, p_client_secret: keys.secret }),
      () => 'حُفظ المفتاحان. اضغط «فحص الاتصال» للتأكد.')
    if (!error) setKeys({ id: '', secret: '' })
  }

  const check = () => run('check', () => supabase.rpc('zad_check'),
    (d) => `الاتصال يعمل — ${d.restaurant} · الوضع: ${d.mode === 'live' ? 'حيّ (يستدعي كباتن حقيقيين)' : 'تجريبي (لا يصل لكابتن)'}`)

  const sync = async () => {
    const { error } = await run('sync', () => supabase.rpc('zad_sync_zones'),
      (r) => `وصلت ${r.synced} منطقة من زاد بأجورها` +
        (r.disabled ? `، وعُطِّلت ${r.disabled} منطقة ليست عند زاد.` : '.'))
    if (!error) onSynced?.()
  }

  const toggle = () => run('toggle', () => supabase.rpc('zad_set_dispatch', { p_on: !st.dispatch }),
    () => (st.dispatch ? 'أُطفئ استدعاء الكابتن.' : 'أُشعل استدعاء الكابتن — يظهر الزر على الطلبات المؤكَّدة.'))

  const input = 'w-full rounded-xl border border-ink-200 bg-white px-2.5 py-2 text-sm focus:border-brand-500 focus:outline-none'
  return (
    <section className="card mt-4 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-extrabold">
        <Bike className="size-4 text-brand-700" /> التوصيل عبر شركة زاد
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-ink-600">
        الكابتن يمرّ على المحل أولاً ويدفع ثمن البضاعة، ثم يوصّل ويحصّل من الزبون.
        يُستدعى بزرّ على الطلب المؤكَّد عند جاهزيته. ابدأ بمفتاح <b>تجريبي</b> (لا يصل لكابتن حقيقي).
      </p>

      {st && (
        <ul className="mb-3 grid gap-1 text-xs text-ink-700">
          <li>المفتاح: <b>{st.configured ? 'محفوظ' : 'غير مضبوط'}</b>
            {st.mode && <> · الوضع: <b>{st.mode === 'live' ? 'حيّ' : 'تجريبي'}</b></>}</li>
          <li>مناطق مرتبطة بزاد: <b className="tnum">{st.zones_linked}</b></li>
          <li>استدعاء الكابتن: <b className={st.dispatch ? 'text-brand-800' : 'text-warn-600'}>{st.dispatch ? 'مُشغَّل' : 'مطفأ'}</b></li>
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-bold text-ink-600">
          client_id
          <input dir="ltr" value={keys.id} onChange={(e) => setKeys({ ...keys, id: e.target.value })}
                 placeholder="zad_test_…" autoComplete="off" className={input + ' mt-1 text-start'} />
        </label>
        <label className="text-xs font-bold text-ink-600">
          client_secret
          <input dir="ltr" type="password" value={keys.secret} onChange={(e) => setKeys({ ...keys, secret: e.target.value })}
                 placeholder="zsk_test_…" autoComplete="new-password" className={input + ' mt-1 text-start'} />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Btn busy={busy} dark name="save" icon={Save} onClick={saveKeys}>حفظ المفتاحين</Btn>
        <Btn busy={busy} name="check" icon={ShieldCheck} onClick={check}>فحص الاتصال</Btn>
        <Btn busy={busy} name="sync" icon={RefreshCw} onClick={sync}>تحديث المناطق من زاد</Btn>
        {st?.configured && (
          <Btn busy={busy} name="toggle" icon={Power} onClick={toggle}>{st.dispatch ? 'إطفاء الاستدعاء' : 'تشغيل الاستدعاء'}</Btn>
        )}
      </div>

      <p role="status" className={`mt-2 text-xs leading-relaxed ${msg.bad ? 'font-bold text-danger-700' : 'text-ink-600'}`}>{msg.text}</p>
    </section>
  )
}
