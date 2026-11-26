import { useEffect, useMemo, useState } from 'react'
import { errText } from '../lib/config'
import { iqd, latin, num } from '../lib/format'
import { Button, Notice, field } from '../ui'
import { nav, priceFor, q, rpc, sb, storeUrl } from './sb'
import { AccountForm, METHOD } from './Earnings'
import { Wordmark } from './Panel'

const PRESETS = [10, 20, 30, 50]
const STEPS = ['اسم المتجر', 'ربحك', 'منتجاتك', 'حساب أرباحك', 'الإرسال']

/** معالج الإنشاء: خمس شاشات، سؤال في كل واحدة. كل خطوة تُحفظ في القاعدة فيستأنف من حيث توقف. */
export default function Wizard({ me, reload }) {
  const store = me.store
  const [step, setStep] = useState(store ? 2 : 1)
  const [name, setName] = useState(store?.name ?? '')
  const [pct, setPct] = useState(store?.markup_type === 'percent' && store.markup_value > 0 ? store.markup_value : me.default_markup)
  const [custom, setCustom] = useState(false)
  const [rows, setRows] = useState([])                 // الكتالوج
  const [suggested, setSuggested] = useState([])       // ترتيب المقترحة
  const [picked, setPicked] = useState(null)           // Set
  const [browse, setBrowse] = useState(false)
  const [slug, setSlug] = useState(store?.slug ?? '')
  const [editSlug, setEditSlug] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [acct, setAcct] = useState(undefined)          // حساب الاستلام الحالي، null إن لم يُضف
  const [editAcct, setEditAcct] = useState(false)

  useEffect(() => {
    if (!store) return
    Promise.all([rpc('reseller_catalog'), rpc('reseller_suggestions', { p_limit: 12 })]).then(([c, s]) => {
      const ok = c.filter((r) => r.base > 0)
      setRows(ok); setSuggested(s.map((x) => x.product_id))
      // من عاد لمعالج بدأه: اختياره المحفوظ (فيه منتج مخفي) يبقى، وإلا فالمقترحة
      const saved = ok.some((r) => !r.is_visible) ? ok.filter((r) => r.is_visible).map((r) => r.product_id) : null
      setPicked((p) => p ?? new Set(saved ?? s.map((x) => x.product_id)))
    }).catch((e) => setErr(errText(e)))
  }, [store?.id])
  const loadAcct = () => q(sb.from('reseller_payout_accounts').select('method,account_no,holder_name').eq('is_current', true).limit(1)).then((a) => setAcct(a[0] ?? null)).catch(() => setAcct(null))
  useEffect(() => { if (store) loadAcct() }, [store?.id])

  const run = async (fn) => {
    setBusy(true); setErr(null)
    try { await fn() } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const p = Math.min(100, Math.max(1, Math.round(+latin(pct)) || 0))
  const byId = useMemo(() => new Map(rows.map((r) => [r.product_id, r])), [rows])
  const sample = rows.find((r) => r.product_id === suggested[0]) ?? rows[0]
  const price = sample ? priceFor(sample.base, p) : 0
  const cats = useMemo(() => [...rows.reduce((m, r) => m.set(r.category, [...(m.get(r.category) ?? []), r]), new Map())], [rows])
  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const choice = (r) => {
    const on = picked?.has(r.product_id)
    return (
      <li key={r.product_id}>
        <button type="button" onClick={() => toggle(r.product_id)} aria-pressed={on}
          className={`flex w-full items-center gap-3 rounded-2xl bg-card p-2.5 text-start ring-1 transition ${on ? 'ring-2 ring-ink' : 'ring-line'}`}>
          <span className="block size-16 shrink-0 overflow-hidden rounded-xl bg-wash">{r.image_url && <img src={r.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />}</span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[14px] font-medium leading-5">{r.name}</span>
            <span className="num mt-1 block text-[13px] text-mute">تبيعه {iqd(priceFor(r.base, p))} · ربحك {iqd(priceFor(r.base, p) - r.base)}</span>
          </span>
          <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-black ${on ? 'bg-ink text-white' : 'ring-1 ring-line text-transparent'}`} aria-hidden="true">✓</span>
        </button>
      </li>
    )
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-8 pt-6">
      <div className="flex items-center justify-between">
        <Wordmark size={44} />
        <button type="button" onClick={() => sb.auth.signOut()} className="min-h-11 rounded-2xl px-3 text-[13px] font-bold text-mute hover:bg-wash">خروج</button>
      </div>
      <div className="mt-6" aria-label={`الخطوة ${step} من ${STEPS.length}`}>
        <div className="flex gap-1.5">{STEPS.map((s, i) => <span key={s} className={`h-1 flex-1 rounded-full ${i < step ? 'bg-ink' : 'bg-line'}`} />)}</div>
        <p className="eyebrow mt-3">الخطوة {step} من {STEPS.length} · {STEPS[step - 1]}</p>
      </div>
      {err && <div className="mt-5"><Notice tone="bad">{err}</Notice></div>}

      {step === 1 && (
        <form className="mt-6 flex flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); run(async () => { await rpc('reseller_quick_start', { p_name: name.trim() }); await reload(); setStep(2) }) }}>
          <h1 className="text-[28px] font-black leading-10">ما اسم متجرك؟</h1>
          <p className="mt-2 text-[16px] font-light leading-7 text-ink-2">هذا ما سيراه زبائنك. يمكنك تغييره لاحقاً.</p>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="مثال: متجر النور" autoComplete="off"
            className={`${field} mt-7 min-h-15 text-[18px]`} aria-label="اسم المتجر" />
          <div className="mt-auto pt-10"><Button variant="ink" type="submit" disabled={busy || name.trim().length < 2}>{busy ? 'لحظة…' : 'التالي'}</Button></div>
        </form>
      )}

      {step === 2 && (
        <div className="mt-6 flex flex-1 flex-col">
          <h1 className="text-[28px] font-black leading-10">كم تريد أن تربح؟</h1>
          <p className="mt-2 text-[16px] font-light leading-7 text-ink-2">نسبة تُضاف على سعر كل منتج، وهي ربحك. وتستطيع تغيير سعر أي منتج لاحقاً.</p>
          <div className="mt-7 grid grid-cols-4 gap-2" role="radiogroup" aria-label="نسبة الربح">
            {PRESETS.map((v) => (
              <button key={v} type="button" role="radio" aria-checked={!custom && pct === v} onClick={() => { setPct(v); setCustom(false) }}
                className={`num min-h-15 rounded-2xl text-[19px] font-extrabold transition ${!custom && pct === v ? 'bg-ink text-white' : 'bg-card ring-1 ring-line'}`}>{v}٪</button>
            ))}
          </div>
          {custom ? (
            <label className="mt-4 flex items-center gap-3"><span className="text-[15px] font-bold">نسبة أخرى</span>
              <input autoFocus inputMode="numeric" value={latin(pct)} onChange={(e) => setPct(e.target.value.replace(/\D/g, '').slice(0, 3))} className={`${field} num w-28 text-center font-bold`} /> ٪</label>
          ) : <button type="button" onClick={() => setCustom(true)} className="mt-3 min-h-11 self-start text-[15px] font-bold underline decoration-line decoration-2 underline-offset-8">نسبة أخرى</button>}

          {sample && (
            <div className="mt-7 rounded-[24px] bg-card p-5 shadow-[var(--shadow-card)]" aria-live="polite">
              <p className="eyebrow">مثال من منتجاتك</p>
              <p className="mt-2 text-[16px] font-bold leading-7">{sample.name}</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-wash p-4"><p className="text-[13px] text-mute">تبيعه بـ</p><p className="num mt-1 text-[20px] font-black">{iqd(price)}</p></div>
                <div className="rounded-2xl bg-brand-soft p-4"><p className="text-[13px] text-brand-deep">ربحك</p><p className="num mt-1 text-[20px] font-black text-brand-deep">{iqd(price - sample.base)}</p></div>
              </div>
            </div>
          )}
          <div className="mt-auto flex gap-3 pt-10">
            <Button variant="quiet" className="w-auto px-6" onClick={() => setStep(1)}>رجوع</Button>
            <Button variant="ink" disabled={busy || p < 1} onClick={() => run(async () => { await rpc('reseller_save_store', { p: { markup_type: 'percent', markup_value: p } }); await reload(); setStep(3) })}>{busy ? 'لحظة…' : 'التالي'}</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-6 flex flex-1 flex-col">
          <h1 className="text-[28px] font-black leading-10">اختر ما تبيعه</h1>
          <p className="mt-2 text-[16px] font-light leading-7 text-ink-2">اخترنا لك الأكثر مبيعاً. أضف أو احذف ما تشاء، أو اعرض كل المنتجات.</p>
          <div className="mt-6 flex items-center justify-between">
            <p className="text-[15px] font-bold">مقترحة لك</p>
            <p className="num text-[13px] text-mute">اخترت {num(picked?.size ?? 0)} منتجاً</p>
          </div>
          <ul className="mt-3 space-y-2.5">{suggested.map((id) => byId.get(id)).filter(Boolean).map(choice)}</ul>
          <button type="button" onClick={() => setPicked(new Set(rows.map((r) => r.product_id)))}
            className="mt-4 min-h-12 rounded-2xl bg-card text-[15px] font-bold ring-1 ring-line">أضف كل المنتجات ({num(rows.length)})</button>
          {!browse ? (
            <button type="button" onClick={() => setBrowse(true)} className="mt-2 min-h-12 text-[15px] font-bold underline decoration-line decoration-2 underline-offset-8">تصفّح كل المنتجات واختر بنفسك</button>
          ) : cats.map(([cat, list]) => (
            <section key={cat} className="mt-7">
              <p className="eyebrow mb-2.5">{cat}</p>
              <ul className="space-y-2.5">{list.map(choice)}</ul>
            </section>
          ))}
          <div className="sticky bottom-0 -mx-6 mt-auto flex gap-3 bg-paper/95 px-6 pt-6 backdrop-blur safe-b">
            <Button variant="quiet" className="w-auto px-6" onClick={() => setStep(2)}>رجوع</Button>
            <Button variant="ink" disabled={busy || !picked?.size} onClick={() => run(async () => { await rpc('reseller_pick_products', { p_ids: [...picked] }); setStep(4) })}>{busy ? 'لحظة…' : `التالي · ${num(picked?.size ?? 0)} منتجاً`}</Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="mt-6 flex flex-1 flex-col">
          <h1 className="text-[28px] font-black leading-10">أين نحوّل أرباحك؟</h1>
          <p className="mt-2 text-[16px] font-light leading-7 text-ink-2">أضف حساب زين كاش أو كي كارد، ونحوّل لك أرباحك عليه مباشرة.</p>
          <div className="mt-7">
            {acct === undefined ? <div className="skeleton h-40 rounded-[24px]" />
              : acct && !editAcct ? (
                <div className="rounded-[24px] bg-card p-5 shadow-[var(--shadow-card)]">
                  <p className="eyebrow">حسابك</p>
                  <p className="mt-2 text-[17px] font-bold">{METHOD[acct.method]} · <span dir="ltr" className="num">••••{String(acct.account_no).slice(-4)}</span></p>
                  <p className="text-[15px] text-ink-2">{acct.holder_name}</p>
                  <button type="button" onClick={() => setEditAcct(true)} className="mt-2 min-h-11 text-[14px] font-bold underline decoration-line decoration-2 underline-offset-8">تغيير</button>
                </div>
              ) : <>
                <AccountForm cur={acct} holder={me.name} label="حفظ والمتابعة" onSaved={async () => { setEditAcct(false); await loadAcct(); setStep(5) }} />
                {acct && <button type="button" onClick={() => setEditAcct(false)} className="mt-3 min-h-12 w-full text-[15px] font-bold text-mute">إلغاء والإبقاء على حسابي</button>}
              </>}
          </div>
          {acct && !editAcct ? (
            <div className="mt-auto flex gap-3 pt-10">
              <Button variant="quiet" className="w-auto px-6" onClick={() => setStep(3)}>رجوع</Button>
              <Button variant="ink" onClick={() => setStep(5)}>التالي</Button>
            </div>
          ) : <button type="button" onClick={() => setStep(3)} className="mt-4 min-h-12 text-[15px] font-bold text-mute">رجوع إلى المنتجات</button>}
        </div>
      )}

      {step === 5 && (
        <div className="mt-6 flex flex-1 flex-col">
          <h1 className="text-[28px] font-black leading-10">متجرك جاهز</h1>
          <p className="mt-2 text-[16px] font-light leading-7 text-ink-2">راجعه ثم أرسله للموافقة. بعد الموافقة تشارك رابطك مع زبائنك.</p>
          <dl className="mt-7 divide-y hairline rounded-[24px] bg-card px-5 shadow-[var(--shadow-card)]">
            <div className="py-4"><dt className="eyebrow">اسم المتجر</dt><dd className="mt-1 text-[18px] font-bold">{store.name}</dd></div>
            <div className="py-4"><dt className="eyebrow">رابط المتجر</dt>
              {editSlug ? (
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await rpc('reseller_save_store', { p: { slug } }); await reload(); setEditSlug(false) }) }}>
                  <input dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={30} autoFocus className={`${field} min-w-0 flex-1 text-start`} aria-label="الرابط" />
                  <button type="submit" disabled={busy} className="min-h-13 rounded-2xl bg-ink px-5 font-bold text-white">حفظ</button>
                </form>
              ) : (
                <dd className="mt-1 flex items-center gap-3"><span dir="ltr" className="min-w-0 flex-1 truncate text-start text-[16px] font-bold">{storeUrl(store.slug).replace(/^https?:\/\//, '')}</span>
                  <button type="button" onClick={() => { setSlug(store.slug); setEditSlug(true) }} className="min-h-11 shrink-0 rounded-xl px-3 text-[14px] font-bold underline decoration-line decoration-2 underline-offset-8">تعديل</button></dd>
              )}
            </div>
            <div className="py-4"><dt className="eyebrow">ربحك</dt><dd className="mt-1 text-[18px] font-bold">{store.markup_value}٪ على كل منتج</dd></div>
            <div className="py-4"><dt className="eyebrow">المنتجات</dt><dd className="mt-1 text-[18px] font-bold">{num(picked?.size ?? 0)} منتجاً</dd></div>
            <div className="py-4"><dt className="eyebrow">حساب الأرباح</dt><dd className="mt-1 text-[18px] font-bold">{acct ? <>{METHOD[acct.method]} · <span dir="ltr" className="num">••••{String(acct.account_no).slice(-4)}</span></> : 'لم يُضف'}</dd></div>
          </dl>
          <p className="mt-4 text-[13px] leading-6 text-mute">بعد الإرسال تضيف منتجاتك الخاصة إن أردت، ويراجعها فريقنا قبل ظهورها.</p>
          <div className="mt-auto flex gap-3 pt-10">
            <Button variant="quiet" className="w-auto px-6" onClick={() => setStep(4)}>رجوع</Button>
            <Button disabled={busy || !acct} onClick={() => run(async () => { await rpc('reseller_submit_store'); nav('#/'); await reload() })}>{busy ? 'لحظة…' : 'أرسل للموافقة'}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
