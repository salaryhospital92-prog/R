import { useEffect, useState } from 'react'
import { Banknote } from 'lucide-react'
import { errText } from '../lib/config'
import { iqd, latin } from '../lib/format'
import { Button, Notice } from '../ui'
import { q, rpc, sb } from './sb'

const METHOD = { zaincash: 'زين كاش', qicard: 'كي كارد' }
const PSTATUS = { open: 'بانتظار التحويل', paid: 'تم التحويل', cancelled: 'ألغيتَه', rejected: 'رُفض' }
const mask = (n) => `••••${String(n).slice(-4)}`
const when = (t) => new Date(t).toLocaleDateString('ar-IQ-u-nu-latn', { dateStyle: 'medium' })

/** أرباحي: الأرقام بلغة بسيطة. حساب الاستلام يُطلب عند أول طلب استلام لا عند التسجيل. */
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
    try { await rpc('reseller_request_payout', { p_method: method ?? null }); flash('أُرسل طلب الاستلام ✓'); await load() } catch (e) { flash(errText(e)) } finally { setBusy(false) }
  }
  const press = () => (accts.length ? request(accts[0].method) : setSheet(true))

  if (err) return <Notice>{err}</Notice>
  if (!bal) return <div className="space-y-3"><div className="skeleton h-32 rounded-3xl" /><div className="skeleton h-20 rounded-2xl" /></div>

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-brand p-5 text-brand-ink" aria-label="المتاح للاستلام">
        <p className="text-sm opacity-90">متاح للاستلام الآن</p>
        <p className="mt-1 text-4xl font-extrabold tabular-nums">{iqd(bal.available)}</p>
        {open ? (
          <p className="mt-4 rounded-2xl bg-white/20 p-3 text-[15px] leading-6">طلبتَ استلام <b className="tabular-nums">{iqd(open.amount)}</b> — {PSTATUS.open}.
            <button type="button" className="ms-2 min-h-11 font-bold underline" onClick={async () => { try { await rpc('reseller_cancel_payout', { p_id: open.id }); flash('أُلغي الطلب'); load() } catch (e) { flash(errText(e)) } }}>إلغاء</button></p>
        ) : (
          <button type="button" disabled={busy || bal.available <= 0} onClick={press}
            className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white font-bold text-stone-900 disabled:opacity-50"><Banknote className="size-5" aria-hidden="true" />اطلب استلام أرباحي</button>
        )}
      </section>
      <p className="text-sm leading-6 text-stone-500">عندما يبلغ المتاح {iqd(bal.threshold)} نطلب لك الاستلام تلقائياً. التحويل يتم يدوياً من الإدارة.</p>

      <section className="grid grid-cols-2 gap-3">
        {[['قيد الانتظار', bal.pending, 'طلبات لم تُسلَّم بعد'], ['مهلة الاستحقاق', bal.held, `${bal.hold_days} أيام بعد التسليم`], ['محجوز لطلب استلام', bal.reserved, ''], ['استلمتَه سابقاً', bal.paid, '']].map(([t, v, h]) => (
          <div key={t} className="rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-200"><p className="text-sm text-stone-500">{t}</p><p className="mt-1 text-lg font-extrabold tabular-nums">{iqd(v)}</p>{h && <p className="text-[12px] text-stone-400">{h}</p>}</div>
        ))}
      </section>

      <section className="rounded-2xl ring-1 ring-stone-200 p-4" aria-label="حساب الاستلام">
        <div className="flex items-center justify-between"><h2 className="font-extrabold">حساب الاستلام</h2><button type="button" onClick={() => setSheet(true)} className="min-h-11 px-1 font-bold text-brand-deep">{accts.length ? 'تغيير' : 'إضافة'}</button></div>
        {accts.length ? accts.map((a) => <p key={a.id} className="mt-1 text-[15px]">{METHOD[a.method]} · <span dir="ltr" className="tabular-nums">{mask(a.account_no)}</span> · {a.holder_name}</p>)
          : <p className="mt-1 text-[15px] leading-7 text-stone-600">لم تضف حساباً بعد. سنطلبه منك عند أول طلب استلام.</p>}
      </section>

      {pays.length > 0 && (
        <section aria-label="طلبات الاستلام"><h2 className="mb-2 font-extrabold">طلبات الاستلام</h2>
          <ul className="space-y-2">{pays.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-2xl bg-stone-50 p-4 ring-1 ring-stone-200">
              <span><b className="tabular-nums">{iqd(p.amount)}</b><br /><span className="text-sm text-stone-500">{when(p.created_at)}{p.reference ? ` · مرجع ${p.reference}` : ''}</span></span>
              <span className="text-sm font-bold">{PSTATUS[p.status]}</span></li>))}</ul></section>
      )}
      {sheet && <AccountSheet cur={accts[0]} holder={me.name} onClose={() => setSheet(false)}
        onSaved={async (method) => { setSheet(false); flash('حُفظ الحساب ✓'); await load(); if (bal.available > 0 && !open) request(method) }} />}
    </div>
  )
}

function AccountSheet({ cur, holder, onClose, onSaved }) {
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
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose} role="dialog" aria-modal="true" aria-label="حساب الاستلام">
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="rise mx-auto max-h-[92dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-3xl bg-white p-5 safe-b">
        <h2 className="text-lg font-extrabold">أين تريد استلام أرباحك؟</h2>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {Object.entries(METHOD).map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={method === k} onClick={() => setMethod(k)}
            className={`min-h-12 rounded-2xl font-bold ring-1 ${method === k ? 'bg-brand text-brand-ink ring-brand' : 'bg-white ring-stone-200'}`}>{v}</button>)}
        </div>
        {err && <Notice>{err}</Notice>}
        <label className="block"><span className="mb-1.5 block text-[15px] font-bold">{method === 'zaincash' ? 'رقم هاتف زين كاش' : 'رقم حساب كي كارد'}</span>
          <input inputMode="numeric" dir="ltr" value={no} onChange={(e) => setNo(e.target.value)} placeholder={method === 'zaincash' ? '07701234567' : ''} autoComplete="off"
            className="min-h-12 w-full rounded-2xl bg-stone-100 px-4 text-start text-lg outline-none focus:ring-2 focus:ring-brand" /></label>
        <label className="block"><span className="mb-1.5 block text-[15px] font-bold">اسم صاحب الحساب</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="min-h-12 w-full rounded-2xl bg-stone-100 px-4 text-lg outline-none focus:ring-2 focus:ring-brand" /></label>
        <p className="text-sm leading-6 text-stone-500">اكتب رقم الحساب فقط. لا تكتب رقم البطاقة كاملاً ولا الرمز السري ولا تاريخ الانتهاء ولا رمز التحقق أبداً.</p>
        <Button type="submit" disabled={busy || bad || name.trim().length < 2}>{busy ? 'لحظة…' : 'حفظ'}</Button>
      </form>
    </div>
  )
}
