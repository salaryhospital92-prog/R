import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { errText, logoUrl } from '../lib/config'
import { latin } from '../lib/format'
import { Button, Notice } from '../ui'
import { q, rpc, sb } from './sb'

const COLORS = ['#059669', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#4f46e5', '#b45309']
const fld = 'min-h-12 w-full rounded-2xl bg-stone-100 px-4 outline-none focus:bg-white focus:ring-2 focus:ring-brand disabled:opacity-60'

/** قص الصورة مربعاً 512×512 وضغطها في المتصفح: PNG صغير بلا أدوات */
async function squareLogo(file) {
  const bmp = await createImageBitmap(file)
  const s = Math.min(bmp.width, bmp.height), c = Object.assign(document.createElement('canvas'), { width: 512, height: 512 })
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 512, 512)
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('x'))), 'image/png'))
}

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
      await rpc('reseller_save_store', { p }); await reload(); flash('حُفظت الإعدادات ✓')
    } catch (x) { setErr(errText(x)) } finally { setBusy(false) }
  }

  const upload = async (e) => {
    const img = e.target.files?.[0]; e.target.value = ''
    if (!img) return
    setBusy(true); setErr(null)
    try {
      const { data: u } = await sb.auth.getUser()
      const path = `${u.user.id}/logo.png`
      const bytes = await (await squareLogo(img)).arrayBuffer()
      const { error } = await sb.storage.from('reseller-logos').upload(path, bytes, { upsert: true, contentType: 'image/png' })
      if (error) throw error
      await rpc('reseller_save_store', { p: { logo_path: path } }); await reload(); flash('تم تغيير الشعار ✓')
    } catch (x) { setErr(x?.code === 'P0001' ? errText(x) : 'تعذّر رفع الصورة. جرّب صورة أخرى.') } finally { setBusy(false) }
  }

  const toggle = async (c) => {
    const on = mine.has(c.id)
    if (on && mine.size === 1) return flash('اترك صنفاً واحداً على الأقل')
    try {
      await q(on ? sb.from('reseller_categories').delete().eq('store_id', store.id).eq('category_id', c.id) : sb.from('reseller_categories').insert({ store_id: store.id, category_id: c.id }))
      const n = new Set(mine); on ? n.delete(c.id) : n.add(c.id); setMine(n)
    } catch (x) { flash(errText(x)) }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {err && <Notice>{err}</Notice>}
      {locked && <Notice tone="info">متجرك قيد المراجعة: الاسم والشعار لا يتغيّران الآن.</Notice>}

      <div className="flex items-center gap-4">
        <button type="button" disabled={locked || busy} onClick={() => file.current.click()} aria-label="تغيير الشعار"
          className="relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand text-3xl font-bold text-brand-ink disabled:opacity-60">
          {store.logo_path ? <img src={logoUrl(store.logo_path)} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : [...store.name.replace(/^ال(?=.)/, '')][0]}
          <span className="absolute inset-x-0 bottom-0 grid place-items-center bg-black/40 py-1 text-white"><Camera className="size-4" aria-hidden="true" /></span>
        </button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={upload} />
        <p className="text-[15px] leading-6 text-stone-600">الشعار اختياري. بدونه نعرض أول حرف من اسمك بلون متجرك.</p>
      </div>

      <label className="block"><span className="mb-1.5 block text-[15px] font-bold">اسم المتجر</span><input className={fld} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={40} disabled={locked} /></label>
      <fieldset><legend className="mb-1.5 text-[15px] font-bold">لون المتجر</legend>
        <div className="flex flex-wrap gap-2.5" role="radiogroup">{COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={f.color === c} aria-label={c} onClick={() => setF({ ...f, color: c })} style={{ background: c }}
            className={`size-11 rounded-full ring-offset-2 ${f.color === c ? 'ring-2 ring-stone-900' : ''}`} />))}</div></fieldset>
      <label className="block"><span className="mb-1.5 block text-[15px] font-bold">نسبة الربح على كل منتج (٪)</span>
        <input className={`${fld} w-28 text-center text-lg font-bold`} inputMode="numeric" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value.replace(/[^\d٠-٩]/g, '').slice(0, 4) })} />
        <span className="mt-1.5 block text-sm text-stone-500">تُضاف على سعر كل منتج. يمكنك تخصيص سعر أي منتج من «المنتجات».</span></label>
      <label className="block"><span className="mb-1.5 block text-[15px] font-bold">رقم واتساب للزبائن (اختياري)</span><input className={fld} dir="ltr" inputMode="tel" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} placeholder="07701234567" /></label>
      <label className="block"><span className="mb-1.5 block text-[15px] font-bold">نبذة عن متجرك (اختياري)</span><textarea className={`${fld} min-h-24 py-3`} rows={3} maxLength={500} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} /></label>

      <fieldset><legend className="mb-1.5 text-[15px] font-bold">الأصناف التي تبيعها</legend>
        {cats ? <div className="flex flex-wrap gap-2">{cats.map((c) => (
          <button key={c.id} type="button" aria-pressed={mine.has(c.id)} onClick={() => toggle(c)}
            className={`min-h-11 rounded-full px-4 text-[15px] font-medium ${mine.has(c.id) ? 'bg-brand text-brand-ink' : 'bg-stone-100 text-stone-700'}`}>{c.name}</button>))}</div>
          : <div className="skeleton h-11 rounded-full" />}</fieldset>

      <Button type="submit" disabled={busy || f.name.trim().length < 2}>{busy ? 'لحظة…' : 'حفظ'}</Button>
    </form>
  )
}
