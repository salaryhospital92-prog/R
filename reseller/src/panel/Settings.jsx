import { useEffect, useRef, useState } from 'react'
import { errText, logoUrl } from '../lib/config'
import { latin } from '../lib/format'
import { Button, Field, Notice, field, initial } from '../ui'
import { rpc, sb } from './sb'
import { squareImage } from './Products'

const COLORS = ['#0e6b57', '#1d4ed8', '#6d28d9', '#be185d', '#c2410c', '#0f766e', '#3730a3', '#92400e', '#17161a']

export default function Settings({ store, reload, flash }) {
  const locked = store.status === 'pending'               // أثناء المراجعة لا يتغيّر الاسم أو الشعار
  const [f, setF] = useState({ name: store.name, whatsapp: store.whatsapp ?? '', about: store.about ?? '', color: store.theme_color, pct: store.markup_type === 'percent' ? String(store.markup_value) : '' })
  const [cats, setCats] = useState(null)
  const [mine, setMine] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const file = useRef(null)

  useEffect(() => {
    rpc('reseller_category_list').then((a) => { setCats(a); setMine(new Set(a.filter((x) => x.selected).map((x) => x.id))) }).catch((e) => setErr(errText(e)))
  }, [])

  const save = async (e) => {
    e.preventDefault()
    const pct = Math.round(+latin(f.pct))
    if (f.pct !== '' && pct === 0 && !confirm('نسبة الربح صفر: ستبيع بلا ربح. هل أنت متأكد؟')) return
    setBusy(true); setErr(null)
    try {
      const p = { whatsapp: f.whatsapp.trim(), about: f.about.trim(), theme_color: f.color }
      if (!locked) p.name = f.name.trim()
      if (f.pct !== '' && !Number.isNaN(pct)) Object.assign(p, { markup_type: 'percent', markup_value: Math.min(1000, Math.max(0, pct)) })
      await rpc('reseller_save_store', { p }); await reload(); flash('حُفظت الإعدادات')
    } catch (x) { setErr(errText(x)) } finally { setBusy(false) }
  }

  const upload = async (e) => {
    const img = e.target.files?.[0]; e.target.value = ''
    if (!img) return
    setBusy(true); setErr(null)
    try {
      const { data: u } = await sb.auth.getUser()
      const path = `${u.user.id}/logo.png`
      const bytes = await (await squareImage(img, 512, 'image/png')).arrayBuffer()
      const { error } = await sb.storage.from('reseller-logos').upload(path, bytes, { upsert: true, contentType: 'image/png' })
      if (error) throw error
      await rpc('reseller_save_store', { p: { logo_path: path } }); await reload(); flash('تغيّر الشعار')
    } catch (x) { setErr(x?.code === 'P0001' ? errText(x) : 'تعذّر رفع الصورة. جرّب صورة أخرى.') } finally { setBusy(false) }
  }

  const toggle = async (c) => {
    const on = mine.has(c.id)
    if (on && mine.size === 1) return flash('اترك صنفاً واحداً على الأقل')
    try {
      const { error } = on ? await sb.from('reseller_categories').delete().eq('store_id', store.id).eq('category_id', c.id) : await sb.from('reseller_categories').insert({ store_id: store.id, category_id: c.id })
      if (error) throw error
      const n = new Set(mine); on ? n.delete(c.id) : n.add(c.id); setMine(n)
    } catch (x) { flash(errText(x)) }
  }

  return (
    <form onSubmit={save} className="space-y-7">
      {err && <Notice tone="bad">{err}</Notice>}
      {locked && <Notice tone="info">متجرك قيد المراجعة: الاسم والشعار لا يتغيّران الآن.</Notice>}

      <div className="flex items-center gap-4">
        <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-[22px] text-[32px] font-black text-white" style={{ background: f.color }}>
          {store.logo_path ? <img src={logoUrl(store.logo_path)} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : initial(f.name)}
        </span>
        <div className="min-w-0">
          <button type="button" disabled={locked || busy} onClick={() => file.current.click()} className="min-h-11 rounded-xl text-[15px] font-bold underline decoration-line decoration-2 underline-offset-8 disabled:text-mute">{store.logo_path ? 'تغيير الشعار' : 'رفع شعار'}</button>
          <p className="text-[13px] leading-5 text-mute">اختياري. بدونه نعرض أول حرف من اسمك بلون متجرك.</p>
        </div>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={upload} />
      </div>

      <Field id="s-name" label="اسم المتجر"><input id="s-name" className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={40} disabled={locked} /></Field>
      <fieldset><legend className="mb-3 text-[14px] font-bold text-ink-2">لون المتجر</legend>
        <div className="flex flex-wrap gap-3" role="radiogroup">{COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={f.color === c} aria-label={`اللون ${c}`} onClick={() => setF({ ...f, color: c })} style={{ background: c }}
            className={`size-11 rounded-full ring-offset-2 ring-offset-paper transition ${f.color === c ? 'ring-2 ring-ink' : ''}`} />))}</div></fieldset>
      <Field id="s-pct" label="نسبة الربح على كل منتج (٪)" hint="تُضاف على سعر كل منتج جاهز. وتستطيع تخصيص سعر أي منتج من «المنتجات».">
        <input id="s-pct" className={`${field} num w-32 text-center text-[18px] font-bold`} inputMode="numeric" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value.replace(/[^\d٠-٩]/g, '').slice(0, 4) })} />
      </Field>
      <Field id="s-wa" label="رقم واتساب للزبائن (اختياري)"><input id="s-wa" className={`${field} num text-right`} dir="ltr" inputMode="tel" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} placeholder="07701234567" /></Field>
      <Field id="s-ab" label="نبذة عن متجرك (اختياري)"><textarea id="s-ab" className={`${field} min-h-24 py-3`} rows={3} maxLength={500} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} /></Field>

      <fieldset><legend className="mb-3 text-[14px] font-bold text-ink-2">الأصناف التي تبيعها</legend>
        {cats ? <div className="flex flex-wrap gap-2">{cats.map((c) => (
          <button key={c.id} type="button" aria-pressed={mine.has(c.id)} onClick={() => toggle(c)}
            className={`min-h-11 rounded-full px-5 text-[14px] transition ${mine.has(c.id) ? 'bg-ink font-bold text-white' : 'bg-card font-medium text-ink-2 ring-1 ring-line'}`}>{c.name}</button>))}</div>
          : <div className="skeleton h-11 rounded-full" />}</fieldset>

      <Button variant="ink" type="submit" disabled={busy || f.name.trim().length < 2}>{busy ? 'لحظة…' : 'حفظ الإعدادات'}</Button>
    </form>
  )
}
