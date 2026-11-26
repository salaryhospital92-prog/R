import { useEffect, useState } from 'react'
import { errText } from '../lib/config'
import { latin } from '../lib/format'
import { Badge, Button, Field, Notice, field } from '../ui'
import { nav, q, sb } from './sb'
import Settings from './Settings'

const RSTATUS = { new: ['جديد', 'brand'], reviewing: ['قيد الدراسة', 'warn'], available: ['توفّر', 'ok'], rejected: ['لا يتوفر', 'mute'] }
const SUPPORT = (import.meta.env.VITE_SUPPORT_WHATSAPP || '').replace(/\D/g, '')

export default function More({ sub, ...ctx }) {
  if (sub === 'settings') return <Sub title="الإعدادات"><Settings {...ctx} /></Sub>
  if (sub === 'requests') return <Sub title="طلب توفير منتج"><Requests {...ctx} /></Sub>
  const item = (to, title, hint) => (
    <li><a href={to} className="flex min-h-18 items-center justify-between gap-4 py-4">
      <span><b className="block text-[16px]">{title}</b><span className="text-[13px] text-mute">{hint}</span></span>
      <span className="text-[20px] text-mute" aria-hidden="true">‹</span></a></li>
  )
  return (
    <ul className="divide-y hairline rounded-[22px] bg-card px-5 shadow-[var(--shadow-card)]">
      {item('#/more/settings', 'الإعدادات', 'الاسم، الشعار، اللون، الأصناف، نسبة الربح')}
      {item('#/products/own', 'منتجاتي الخاصة', 'أضف منتجات من عندك وحدّد أجرة توصيلها')}
      {item('#/more/requests', 'طلب توفير منتج', 'تريد منتجاً غير موجود؟ اطلبه منّا')}
      {SUPPORT && <li><a href={`https://wa.me/${SUPPORT}`} target="_blank" rel="noopener noreferrer" className="flex min-h-18 items-center justify-between gap-4 py-4">
        <span><b className="block text-[16px]">مساعدة</b><span className="text-[13px] text-mute">تواصل معنا عبر واتساب</span></span></a></li>}
    </ul>
  )
}

const Sub = ({ title, children }) => (
  <div>
    <div className="mb-6 flex items-center justify-between gap-3"><h1 className="text-[22px] font-black">{title}</h1>
      <button type="button" onClick={() => nav('#/more')} className="-me-2 min-h-12 rounded-2xl px-2 text-[15px] font-bold text-mute hover:bg-wash">رجوع</button></div>
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
      setF({ name: '', url: '', qty: '', note: '' }); flash('أُرسل طلبك'); load()
    } catch (x) { setErr(/20 طلب/.test(x?.message ?? '') ? x.message : errText(x)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-8">
      <form onSubmit={send} className="space-y-5">
        <p className="text-[15px] leading-7 text-ink-2">اكتب اسم المنتج الذي تريده، وسنرد عليك إن كان بالإمكان توفيره.</p>
        {err && <Notice tone="bad">{err}</Notice>}
        <Field id="rn" label="اسم المنتج"><input id="rn" className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} /></Field>
        <Field id="ru" label="رابط المنتج (اختياري)"><input id="ru" className={field} dir="ltr" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://" /></Field>
        <Field id="rq" label="الكمية التي تتوقع بيعها (اختياري)"><input id="rq" className={field} inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        <Field id="rt" label="ملاحظة (اختياري)"><textarea id="rt" className={`${field} min-h-20 py-3`} rows={2} maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <Button variant="ink" type="submit" disabled={busy || f.name.trim().length < 2}>{busy ? 'لحظة…' : 'أرسل الطلب'}</Button>
      </form>
      {rows?.length > 0 && (
        <section><h2 className="mb-3 text-[16px] font-extrabold">طلباتك</h2>
          <ul className="divide-y hairline rounded-[22px] bg-card px-5 shadow-[var(--shadow-card)]">{rows.map((r) => (
            <li key={r.id} className="py-4"><div className="flex justify-between gap-3"><b className="text-[15px]">{r.name}</b><Badge tone={RSTATUS[r.status][1]}>{RSTATUS[r.status][0]}</Badge></div>
              {r.reply && <p className="mt-1 text-[14px] leading-6 text-ink-2">{r.reply}</p>}</li>))}</ul></section>
      )}
    </div>
  )
}
