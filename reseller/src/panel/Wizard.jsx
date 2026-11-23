import { useEffect, useState } from 'react'
import { ArrowRight, Check, LogOut, Pencil } from 'lucide-react'
import { errText } from '../lib/config'
import { iqd, latin, num } from '../lib/format'
import { Button, Notice } from '../ui'
import { nav, priceFor, rpc, sb, storeUrl } from './sb'

const PRESETS = [10, 20, 30, 50]

/** معالج الإنشاء: ثلاث شاشات، سؤال في كل واحدة. كل خطوة تُحفظ في القاعدة فيستأنف من حيث توقف. */
export default function Wizard({ me, reload }) {
  const store = me.store
  const [step, setStep] = useState(store ? 2 : 1)
  const [name, setName] = useState(store?.name ?? '')
  const [pct, setPct] = useState(store?.markup_type === 'percent' && store.markup_value > 0 ? store.markup_value : me.default_markup)
  const [custom, setCustom] = useState(false)
  const [sample, setSample] = useState(null)             // منتج حقيقي للمثال الحي
  const [count, setCount] = useState(0)
  const [slug, setSlug] = useState(store?.slug ?? '')
  const [editSlug, setEditSlug] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!store) return
    rpc('reseller_catalog').then((rows) => {
      const ok = rows.filter((r) => r.base > 0)
      setCount(ok.length)
      setSample(ok.find((r) => r.base >= 4000 && r.base <= 40000 && r.is_visible) ?? ok[0] ?? null)
    }).catch(() => {})
  }, [store?.id])

  const run = async (fn) => {
    setBusy(true); setErr(null)
    try { await fn() } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const p = Math.min(100, Math.max(1, Math.round(+latin(pct)) || 0))
  const price = sample ? priceFor(sample.base, p) : 0

  const dots = (
    <div className="mb-8 flex items-center justify-center gap-2" aria-label={`الخطوة ${step} من 3`}>
      {[1, 2, 3].map((n) => <span key={n} className={`h-2 rounded-full transition-all ${n === step ? 'w-8 bg-brand' : n < step ? 'w-2 bg-brand' : 'w-2 bg-stone-200'}`} />)}
    </div>
  )
  const back = step > 1 && step < 3 + 1 && (
    <button type="button" onClick={() => setStep(step - 1)} className="mb-2 grid size-11 place-items-center rounded-xl active:bg-stone-100" aria-label="رجوع"><ArrowRight className="size-6" /></button>
  )

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6 py-6">
      <div className="flex items-center justify-between">
        {step > 1 ? back : <span />}
        <button type="button" onClick={() => sb.auth.signOut()} aria-label="خروج" className="grid size-11 place-items-center rounded-xl text-stone-400 active:bg-stone-100"><LogOut className="size-5" /></button>
      </div>
      {dots}
      {err && <div className="mb-4"><Notice>{err}</Notice></div>}

      {step === 1 && (
        <form className="flex flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); run(async () => { await rpc('reseller_quick_start', { p_name: name.trim() }); await reload(); setStep(2) }) }}>
          <h1 className="text-2xl font-extrabold">ما اسم متجرك؟</h1>
          <p className="mt-2 text-stone-600">هذا الاسم سيراه زبائنك. يمكنك تغييره لاحقاً.</p>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="مثال: متجر النور" autoComplete="off"
            className="mt-6 min-h-14 w-full rounded-2xl bg-stone-100 px-4 text-lg outline-none focus:bg-white focus:ring-2 focus:ring-brand" aria-label="اسم المتجر" />
          <div className="mt-auto pt-8"><Button type="submit" disabled={busy || name.trim().length < 2}>{busy ? 'لحظة…' : 'التالي'}</Button></div>
        </form>
      )}

      {step === 2 && (
        <div className="flex flex-1 flex-col">
          <h1 className="text-2xl font-extrabold">كم تريد أن تربح؟</h1>
          <p className="mt-2 text-stone-600">نضيف نسبة على سعر كل منتج، وهي ربحك. يمكنك تغييرها لكل منتج لاحقاً.</p>
          <div className="mt-6 grid grid-cols-4 gap-2" role="radiogroup" aria-label="نسبة الربح">
            {PRESETS.map((v) => (
              <button key={v} type="button" role="radio" aria-checked={!custom && pct === v} onClick={() => { setPct(v); setCustom(false) }}
                className={`min-h-14 rounded-2xl text-lg font-extrabold tabular-nums ring-1 transition ${!custom && pct === v ? 'bg-brand text-brand-ink ring-brand' : 'bg-white ring-stone-200'}`}>{v}٪</button>
            ))}
          </div>
          {custom ? (
            <label className="mt-3 flex items-center gap-3"><span className="text-[15px] font-bold">نسبة أخرى</span>
              <input autoFocus inputMode="numeric" value={latin(pct)} onChange={(e) => setPct(e.target.value.replace(/\D/g, '').slice(0, 3))}
                className="min-h-12 w-24 rounded-2xl bg-stone-100 px-4 text-center text-lg font-bold tabular-nums outline-none focus:ring-2 focus:ring-brand" /> ٪</label>
          ) : <button type="button" onClick={() => setCustom(true)} className="mt-3 min-h-11 text-[15px] font-bold text-brand-deep underline underline-offset-4">نسبة أخرى</button>}

          {sample && (
            <div className="mt-6 rounded-3xl bg-brand-soft p-5" aria-live="polite">
              <p className="text-sm font-bold text-brand-deep">مثال من منتجاتك</p>
              <p className="mt-2 font-bold leading-7">{sample.name}</p>
              <p className="mt-3 text-lg leading-8">تبيعه بـ <b className="tabular-nums">{iqd(price)}</b></p>
              <p className="text-lg leading-8">وربحك <b className="tabular-nums text-brand-deep">{iqd(price - sample.base)}</b></p>
            </div>
          )}
          <div className="mt-auto pt-8">
            <Button disabled={busy || p < 1} onClick={() => run(async () => { await rpc('reseller_save_store', { p: { markup_type: 'percent', markup_value: p } }); await reload(); setStep(3) })}>{busy ? 'لحظة…' : 'التالي'}</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-1 flex-col">
          <h1 className="text-2xl font-extrabold">متجرك جاهز</h1>
          <p className="mt-2 text-stone-600">راجع ثم أرسله للموافقة. بعد الموافقة تشارك رابطك مع زبائنك.</p>
          <dl className="mt-6 divide-y divide-stone-100 rounded-3xl ring-1 ring-stone-200">
            <div className="p-4"><dt className="text-sm text-stone-500">اسم المتجر</dt><dd className="mt-0.5 text-lg font-bold">{store.name}</dd></div>
            <div className="p-4"><dt className="text-sm text-stone-500">رابط المتجر</dt>
              {editSlug ? (
                <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await rpc('reseller_save_store', { p: { slug } }); await reload(); setEditSlug(false) }) }}>
                  <input dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={30} autoFocus
                    className="min-h-12 min-w-0 flex-1 rounded-2xl bg-stone-100 px-3 text-start outline-none focus:ring-2 focus:ring-brand" aria-label="الرابط" />
                  <button type="submit" disabled={busy} className="grid size-12 place-items-center rounded-2xl bg-brand text-brand-ink" aria-label="حفظ"><Check className="size-5" /></button>
                </form>
              ) : (
                <dd className="mt-0.5 flex items-center gap-2"><span dir="ltr" className="min-w-0 flex-1 truncate text-start font-bold">{storeUrl(store.slug).replace(/^https?:\/\//, '')}</span>
                  <button type="button" onClick={() => { setSlug(store.slug); setEditSlug(true) }} className="grid size-11 place-items-center rounded-xl text-stone-500 active:bg-stone-100" aria-label="تعديل الرابط"><Pencil className="size-4" /></button></dd>
              )}
            </div>
            <div className="p-4"><dt className="text-sm text-stone-500">ربحك</dt><dd className="mt-0.5 text-lg font-bold">{store.markup_value}٪ على كل منتج</dd></div>
            <div className="p-4"><dt className="text-sm text-stone-500">المنتجات</dt><dd className="mt-0.5 text-lg font-bold">{count ? `${num(count)} منتج جاهز للبيع` : 'كل المنتجات'}</dd></div>
          </dl>
          <div className="mt-auto pt-8">
            <Button disabled={busy} onClick={() => run(async () => { await rpc('reseller_submit_store'); nav('#/'); await reload() })}>{busy ? 'لحظة…' : 'أرسل للموافقة'}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
