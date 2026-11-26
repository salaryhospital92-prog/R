import { useEffect, useState } from 'react'
import { errText } from '../lib/config'
import { iqd, latin } from '../lib/format'
import { Badge, Button, Field, Notice, Sheet, field } from '../ui'
import { q, rpc, sb } from './sb'

export const METHOD = { zaincash: 'زين كاش', qicard: 'كي كارد' }
const PSTATUS = { open: ['بانتظار التحويل', 'warn'], paid: ['تم التحويل', 'ok'], cancelled: ['ألغيتَه', 'mute'], rejected: ['رُفض', 'bad'] }
const mask = (n) => `••••${String(n).slice(-4)}`
const when = (t) => new Date(t).toLocaleDateString('ar-IQ-u-nu-latn', { dateStyle: 'medium' })

/** أرباحي: الأرقام بلغة بسيطة. حساب الاستلام يُضاف في معالج التسجيل، ويُغيَّر من هنا. */
export default function Earnings({ me, flash }) {
  const [bal, setBal] = useState(null)
  const [accts, setAccts] = useState([])
  const [pays, setPays] = useState([])
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const load = async () => {
    try {
      const [b, a, p] = await Promise.all([rpc('reseller_balance'),
        q(sb.from('reseller_payout_accounts').select('id,method,account_no,holder_name').eq('is_current', true)),
        q(sb.from('reseller_payouts').select('id,amount,status,origin,reference,reason,created_at').order('created_at', { ascending: false }).limit(10))])
      setBal(b); setAccts(a); setPays(p); setErr(null)
    } catch (e) { setErr(errText(e)) }
  }
  useEffect(() => { load() }, [])

  const open = pays.find((p) => p.status === 'open')
  const request = async (method) => {
    setBusy(true)
    try { await rpc('reseller_request_payout', { p_method: method ?? null }); flash('أُرسل طلب الاستلام'); await load() } catch (e) { flash(errText(e)) } finally { setBusy(false) }
  }
  const press = () => (accts.length ? request(accts[0].method) : setSheet(true))

  if (err) return <Notice tone="bad">{err}</Notice>
  if (!bal) return <div className="space-y-3"><div className="skeleton h-40 rounded-[24px]" /><div className="skeleton h-20 rounded-[22px]" /></div>

  return (
    <div className="space-y-7">
      <section className="rounded-[24px] bg-ink p-6 text-white" aria-label="المتاح للاستلام">
        <p className="text-[13px] font-bold text-white/60">متاح للاستلام الآن</p>
        <p className="num mt-2 text-[40px] font-black leading-none">{iqd(bal.available)}</p>
        {open ? (
          <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl bg-white/10 px-4 py-3 text-[14px]">
            <span>طلبتَ استلام <b className="num">{iqd(open.amount)}</b> · بانتظار التحويل</span>
            <button type="button" className="min-h-10 rounded-xl px-2 font-bold underline underline-offset-4" onClick={async () => { try { await rpc('reseller_cancel_payout', { p_id: open.id }); flash('أُلغي الطلب'); load() } catch (e) { flash(errText(e)) } }}>إلغاء</button>
          </div>
        ) : (
          <button type="button" disabled={busy || bal.available <= 0} onClick={press} className="mt-6 min-h-13 w-full rounded-2xl bg-white text-[16px] font-bold text-ink disabled:opacity-40">اطلب استلام أرباحي</button>
        )}
      </section>
      <p className="-mt-3 text-[13px] leading-6 text-mute">عندما يبلغ المتاح {iqd(bal.threshold)} نطلب لك الاستلام تلقائياً. التحويل يتم يدوياً من الإدارة.</p>

      <section className="grid grid-cols-2 gap-3">
        {[['قيد الانتظار', bal.pending, 'طلبات لم تُسلَّم بعد'], ['مهلة الاستحقاق', bal.held, `${bal.hold_days} أيام بعد التسليم`], ['محجوز لطلب استلام', bal.reserved, ''], ['استلمتَه سابقاً', bal.paid, '']].map(([t, v, h]) => (
          <div key={t} className="rounded-[22px] bg-card p-5 shadow-[var(--shadow-card)]"><p className="text-[13px] text-mute">{t}</p><p className="num mt-1 text-[19px] font-extrabold">{iqd(v)}</p>{h && <p className="mt-0.5 text-[12px] text-mute">{h}</p>}</div>
        ))}
      </section>

      <section className="rounded-[22px] bg-card p-5 shadow-[var(--shadow-card)]" aria-label="حساب الاستلام">
        <div className="flex items-center justify-between"><h2 className="text-[16px] font-extrabold">حساب الاستلام</h2>
          <button type="button" onClick={() => setSheet(true)} className="min-h-11 px-1 text-[14px] font-bold underline decoration-line decoration-2 underline-offset-8">{accts.length ? 'تغيير' : 'إضافة'}</button></div>
        {accts.length ? accts.map((a) => <p key={a.id} className="mt-1 text-[15px]">{METHOD[a.method]} · <span dir="ltr" className="num">{mask(a.account_no)}</span> · {a.holder_name}</p>)
          : <p className="mt-1 text-[15px] leading-7 text-ink-2">لم تضف حساباً بعد. أضفه لنحوّل لك أرباحك.</p>}
      </section>

      {pays.length > 0 && (
        <section aria-label="طلبات الاستلام"><h2 className="mb-3 text-[16px] font-extrabold">طلبات الاستلام</h2>
          <ul className="divide-y hairline rounded-[22px] bg-card px-5 shadow-[var(--shadow-card)]">{pays.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-4">
              <span><b className="num">{iqd(p.amount)}</b><br /><span className="text-[13px] text-mute">{when(p.created_at)}{p.reference ? ` · مرجع ${p.reference}` : ''}</span></span>
              <Badge tone={PSTATUS[p.status][1]}>{PSTATUS[p.status][0]}</Badge></li>))}</ul></section>
      )}
      {sheet && <AccountSheet cur={accts[0]} holder={me.name} onClose={() => setSheet(false)}
        onSaved={async (method) => { setSheet(false); flash('حُفظ الحساب'); await load(); if (bal.available > 0 && !open) request(method) }} />}
    </div>
  )
}

function AccountSheet({ cur, holder, onClose, onSaved }) {
  return <Sheet title="أين تستلم أرباحك؟" onClose={onClose}><AccountForm cur={cur} holder={holder} onSaved={onSaved} /></Sheet>
}

/** حساب الاستلام: زين كاش (رقم الهاتف) أو كي كارد (رقم الحساب فقط). يُستعمل في المعالج وفي «أرباحي». */
export function AccountForm({ cur, holder, onSaved, label = 'حفظ' }) {
  const [method, setMethod] = useState(cur?.method ?? 'zaincash')
  const [no, setNo] = useState('')
  const [name, setName] = useState(cur?.holder_name ?? holder ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const n = latin(no).replace(/\s/g, '')
  const bad = method === 'zaincash' ? !/^07\d{9}$/.test(n) : !/^\d{6,15}$/.test(n)
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { await rpc('reseller_save_payout_account', { p_method: method, p_account_no: n, p_holder: name.trim() }); onSaved(method) } catch (x) { setErr(errText(x)) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid grid-cols-2 rounded-2xl bg-wash p-1" role="radiogroup" aria-label="طريقة الاستلام">
        {Object.entries(METHOD).map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={method === k} onClick={() => setMethod(k)}
          className={`min-h-12 rounded-xl text-[15px] ${method === k ? 'bg-card font-bold shadow-[var(--shadow-card)]' : 'font-medium text-mute'}`}>{v}</button>)}
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      <Field id="acc" label={method === 'zaincash' ? 'رقم هاتف زين كاش' : 'رقم حساب كي كارد'} hint="رقم الحساب فقط. لا تكتب رقم البطاقة كاملاً ولا الرمز السري ولا تاريخ الانتهاء ولا رمز التحقق.">
        <input id="acc" inputMode="numeric" dir="ltr" value={no} onChange={(e) => setNo(e.target.value)} placeholder={method === 'zaincash' ? '07701234567' : ''} autoComplete="off" className={`${field} num text-start text-[18px]`} />
      </Field>
      <Field id="hold" label="اسم صاحب الحساب"><input id="hold" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={field} /></Field>
      <Button variant="ink" type="submit" disabled={busy || bad || name.trim().length < 2}>{busy ? 'لحظة…' : label}</Button>
    </form>
  )
}
