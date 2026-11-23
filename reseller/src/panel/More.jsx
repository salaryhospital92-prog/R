import { useEffect, useState } from 'react'
import { ArrowRight, ChevronLeft, HelpCircle, PackagePlus, Settings as Cog } from 'lucide-react'
import { errText } from '../lib/config'
import { latin } from '../lib/format'
import { Button, Notice } from '../ui'
import { nav, q, sb } from './sb'
import Settings from './Settings'

const RSTATUS = { new: 'جديد', reviewing: 'قيد الدراسة', available: 'توفّر ✓', rejected: 'لا يتوفر' }
const SUPPORT = (import.meta.env.VITE_SUPPORT_WHATSAPP || '').replace(/\D/g, '')

export default function More({ sub, ...ctx }) {
  if (sub === 'settings') return <Sub title="الإعدادات"><Settings {...ctx} /></Sub>
  if (sub === 'requests') return <Sub title="طلب توفير منتج"><Requests {...ctx} /></Sub>
  const item = (to, Icon, title, hint) => (
    <li><a href={`#/more/${to}`} className="flex min-h-16 items-center gap-4 rounded-2xl p-4 ring-1 ring-stone-200 active:bg-stone-50">
      <Icon className="size-6 text-brand-deep" aria-hidden="true" /><span className="flex-1"><b className="block">{title}</b><span className="text-sm text-stone-500">{hint}</span></span>
      <ChevronLeft className="size-5 text-stone-400" aria-hidden="true" /></a></li>
  )
  return (
    <ul className="space-y-3">
      {item('settings', Cog, 'الإعدادات', 'الاسم، الشعار، اللون، الأصناف، نسبة الربح')}
      {item('requests', PackagePlus, 'طلب توفير منتج', 'تريد منتجاً غير موجود؟ اطلبه هنا')}
      {SUPPORT && <li><a href={`https://wa.me/${SUPPORT}`} target="_blank" rel="noopener noreferrer" className="flex min-h-16 items-center gap-4 rounded-2xl p-4 ring-1 ring-stone-200">
        <HelpCircle className="size-6 text-brand-deep" aria-hidden="true" /><span className="flex-1"><b className="block">مساعدة</b><span className="text-sm text-stone-500">تواصل معنا عبر واتساب</span></span></a></li>}
    </ul>
  )
}

const Sub = ({ title, children }) => (
  <div>
    <div className="mb-4 flex items-center gap-1"><button type="button" onClick={() => nav('#/more')} aria-label="رجوع" className="-ms-2 grid size-11 place-items-center rounded-xl active:bg-stone-100"><ArrowRight className="size-6" /></button>
      <h1 className="text-xl font-extrabold">{title}</h1></div>
    {children}
  </div>
)

function Requests({ store, flash }) {
  const [rows, setRows] = useState(null)
  const [f, setF] = useState({ name: '', url: '', qty: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const load = () => q(sb.from('reseller_product_requests').select('id,name,status,reply,created_at').order('created_at', { ascending: false }).limit(30)).then(setRows).catch((e) => setErr(errText(e)))
  useEffect(() => { load() }, [])
  const send = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const url = f.url.trim()
      const qty = +latin(f.qty).replace(/\D/g, '')
      await q(sb.from('reseller_product_requests').insert({ store_id: store.id, name: f.name.trim(), url: url ? (/^https?:\/\//.test(url) ? url.replace(/^http:/, 'https:') : `https://${url}`) : null, expected_qty: qty > 0 ? qty : null, note: f.note.trim() || null }))
      setF({ name: '', url: '', qty: '', note: '' }); flash('أُرسل طلبك ✓'); load()
    } catch (x) { setErr(/20 طلب/.test(x?.message ?? '') ? x.message : errText(x)) } finally { setBusy(false) }
  }
  const fld = 'min-h-12 w-full rounded-2xl bg-stone-100 px-4 outline-none focus:bg-white focus:ring-2 focus:ring-brand'
  return (
    <div className="space-y-6">
      <form onSubmit={send} className="space-y-4">
        <p className="leading-7 text-stone-600">اكتب اسم المنتج الذي تريده، وسنرد عليك إن كان بالإمكان توفيره.</p>
        {err && <Notice>{err}</Notice>}
        <label className="block"><span className="mb-1.5 block text-[15px] font-bold">اسم المنتج</span><input className={fld} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} /></label>
        <label className="block"><span className="mb-1.5 block text-[15px] font-bold">رابط المنتج (اختياري)</span><input className={fld} dir="ltr" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" /></label>
        <label className="block"><span className="mb-1.5 block text-[15px] font-bold">الكمية التي تتوقع بيعها (اختياري)</span><input className={fld} inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></label>
        <label className="block"><span className="mb-1.5 block text-[15px] font-bold">ملاحظة (اختياري)</span><textarea className={`${fld} min-h-20 py-3`} rows={2} maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <Button type="submit" disabled={busy || f.name.trim().length < 2}>{busy ? 'لحظة…' : 'أرسل الطلب'}</Button>
      </form>
      {rows?.length > 0 && (
        <section><h2 className="mb-2 font-extrabold">طلباتك</h2>
          <ul className="space-y-2">{rows.map((r) => (
            <li key={r.id} className="rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-200"><div className="flex justify-between gap-3"><b>{r.name}</b><span className="shrink-0 text-sm font-bold">{RSTATUS[r.status]}</span></div>
              {r.reply && <p className="mt-1 text-[15px] leading-6 text-stone-600">{r.reply}</p>}</li>))}</ul></section>
      )}
    </div>
  )
}
