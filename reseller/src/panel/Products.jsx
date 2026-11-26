import { useEffect, useMemo, useRef, useState } from 'react'
import { errText, ownImageUrl } from '../lib/config'
import { iqd, latin, norm } from '../lib/format'
import { packName } from '../lib/qty'
import { Badge, Button, Field, Notice, Sheet, field } from '../ui'
import { q, rpc, sb } from './sb'

const PAGE = 40
const Thumb = ({ src, dim, size = 'size-16' }) => (
  <span className={`relative block ${size} shrink-0 overflow-hidden rounded-2xl bg-wash ${dim ? 'opacity-40 grayscale' : ''}`}>
    {src && <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-cover" />}
  </span>
)
const Tabs = ({ value, items }) => (
  <div className="grid grid-cols-2 rounded-2xl bg-wash p-1" role="tablist">
    {items.map(([href, label]) => (
      <a key={href} href={href} role="tab" aria-selected={value === href}
        className={`grid min-h-12 place-items-center rounded-xl text-[15px] transition ${value === href ? 'bg-card font-bold shadow-[var(--shadow-card)]' : 'font-medium text-mute'}`}>{label}</a>
    ))}
  </div>
)

export default function Products(props) {
  return (
    <div>
      <Tabs value={props.sub === 'own' ? '#/products/own' : '#/products'} items={[['#/products', 'منتجات جاهزة'], ['#/products/own', 'منتجاتي الخاصة']]} />
      <div className="mt-6">{props.sub === 'own' ? <Own {...props} /> : <Ready {...props} />}</div>
    </div>
  )
}

/** المنتجات الجاهزة: المقترحة أولاً، ثم الكل. لمسة على الصورة تُخفي/تُظهر، والسطر يفتح السعر */
function Ready({ store, flash }) {
  const [rows, setRows] = useState(null)
  const [sug, setSug] = useState([])
  const [filter, setFilter] = useState({ q: '', cat: 0, hidden: false })
  const [more, setMore] = useState(PAGE)
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState(null)

  const load = () => Promise.all([rpc('reseller_catalog'), rpc('reseller_suggestions', { p_limit: 12 })])
    .then(([c, s]) => { setRows(c.filter((x) => x.base > 0)); setSug(s.map((x) => x.product_id)) }).catch((e) => setErr(errText(e)))
  useEffect(() => { load() }, [])

  const cats = useMemo(() => [...new Map((rows ?? []).map((r) => [r.category_id, r.category]))].sort((a, b) => a[1].localeCompare(b[1], 'ar')), [rows])
  const list = useMemo(() => {
    const t = norm(filter.q).trim()
    return (rows ?? []).filter((r) => (!filter.cat || r.category_id === filter.cat) && (!filter.hidden || !r.is_visible) && (!t || norm(r.name).includes(t)))
  }, [rows, filter])
  const toAdd = useMemo(() => sug.map((id) => rows?.find((r) => r.product_id === id)).filter((r) => r && !r.is_visible), [sug, rows])

  const upsert = (r, patch) => q(sb.from('reseller_products').upsert({ store_id: store.id, product_id: r.product_id, ...patch }, { onConflict: 'store_id,product_id' }))
  /** يحفظ ويعيد التحميل. prev: ما نعود إليه عند «تراجع» */
  const save = async (r, patch, prev, msg) => {
    try {
      await upsert(r, patch); await load()
      flash(msg, { label: 'تراجع', run: async () => { try { await upsert(r, prev); await load() } catch (e) { flash(errText(e)) } } })
    } catch (e) { flash(/row-level/.test(e?.message ?? '') ? 'لا يمكن التعديل الآن (المتجر موقوف)' : errText(e)) }
  }
  const unit = (r) => (r.pack_qty ? `لل${packName(r.pack_qty)} (${r.pack_qty} قطعة)` : 'للقطعة')
  const set = (patch) => { setFilter({ ...filter, ...patch }); setMore(PAGE) }

  if (err) return <Notice tone="bad">{err}</Notice>
  if (!rows) return <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div>

  return (
    <div>
      {toAdd.length > 0 && !filter.q && !filter.cat && (
        <section className="mb-8 rounded-[24px] bg-card p-5 shadow-[var(--shadow-card)]" aria-label="أضف المنتجات التالية">
          <p className="text-[17px] font-extrabold">أضف المنتجات التالية</p>
          <p className="mt-1 text-[14px] text-ink-2">الأكثر طلباً، وليست في متجرك بعد.</p>
          <ul className="no-scrollbar -mx-5 mt-4 flex gap-3 overflow-x-auto px-5">
            {toAdd.map((r) => (
              <li key={r.product_id} className="w-36 shrink-0">
                <Thumb src={r.image_url} size="size-36" />
                <p className="mt-2 line-clamp-2 min-h-10 text-[13px] font-medium leading-5">{r.name}</p>
                <p className="num text-[12px] text-mute">ربحك {iqd(r.profit)}</p>
                <button type="button" onClick={() => save(r, { is_visible: true }, { is_visible: false }, 'أُضيف إلى متجرك')}
                  className="mt-2 min-h-10 w-full rounded-full bg-ink text-[13px] font-bold text-white">أضف</button>
              </li>
            ))}
          </ul>
          {toAdd.length > 1 && (
            <button type="button" className="mt-4 min-h-11 text-[14px] font-bold underline decoration-line decoration-2 underline-offset-8"
              onClick={async () => { try { await Promise.all(toAdd.map((r) => upsert(r, { is_visible: true }))); await load(); flash('أُضيفت كلها') } catch (e) { flash(errText(e)) } }}>أضف الكل ({toAdd.length})</button>
          )}
        </section>
      )}

      <input type="search" value={filter.q} onChange={(e) => set({ q: e.target.value })} placeholder="ابحث في منتجاتك" aria-label="ابحث في منتجاتك" className={field} />
      <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5">
        <button type="button" onClick={() => set({ hidden: !filter.hidden })} aria-pressed={filter.hidden}
          className={`min-h-11 shrink-0 rounded-full px-4 text-[14px] ${filter.hidden ? 'bg-ink font-bold text-white' : 'bg-card font-medium text-ink-2 ring-1 ring-line'}`}>غير المعروضة</button>
        {[[0, 'الكل'], ...cats].map(([id, name]) => (
          <button key={id} type="button" onClick={() => set({ cat: id })} aria-pressed={filter.cat === id}
            className={`min-h-11 shrink-0 rounded-full px-4 text-[14px] ${filter.cat === id ? 'bg-ink font-bold text-white' : 'bg-card font-medium text-ink-2 ring-1 ring-line'}`}>{name}</button>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-mute">المس الصورة لإظهار المنتج في متجرك أو إخفائه، والمس الاسم لتعديل سعره.</p>

      <ul className="mt-1 divide-y hairline">
        {list.slice(0, more).map((r) => (
          <li key={r.product_id} className="flex items-center gap-4 py-4">
            <button type="button" aria-label={r.is_visible ? `إخفاء ${r.name}` : `إظهار ${r.name}`} aria-pressed={r.is_visible}
              onClick={() => save(r, { is_visible: !r.is_visible }, { is_visible: r.is_visible }, r.is_visible ? 'أُخفي من متجرك' : 'ظهر في متجرك')}>
              <Thumb src={r.image_url} dim={!r.is_visible} />
            </button>
            <button type="button" onClick={() => setEdit(r)} className="min-w-0 flex-1 text-start">
              <span className={`line-clamp-2 text-[15px] font-medium leading-6 ${r.is_visible ? '' : 'text-mute'}`}>{r.name}</span>
              <span className="mt-1 flex flex-wrap items-baseline gap-x-3">
                <span className="num text-[16px] font-extrabold">{iqd(r.price)}</span>
                <span className="num text-[13px] font-bold text-brand-deep">ربحك {iqd(r.profit)}</span>
              </span>
              <span className="mt-1 flex flex-wrap gap-1.5 text-[12px] text-mute">{unit(r)}
                {r.has_override && <Badge tone="brand">سعر مخصّص</Badge>}{!r.is_visible && <Badge>غير معروض</Badge>}{!r.in_stock && <Badge tone="warn">نفد</Badge>}</span>
            </button>
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="py-14 text-center text-mute">لا منتجات مطابقة</p>}
      {list.length > more && <button type="button" onClick={() => setMore(more + PAGE)} className="mt-4 min-h-13 w-full rounded-2xl bg-card font-bold ring-1 ring-line">عرض المزيد</button>}
      {edit && <PriceSheet r={edit} onClose={() => setEdit(null)} onSave={(patch) => { const r = edit; setEdit(null); save(r, patch, { price_override: r.has_override ? r.price : null }, patch.price_override ? 'حُفظ السعر' : 'عاد السعر تلقائياً') }} />}
    </div>
  )
}

function PriceSheet({ r, onClose, onSave }) {
  const [v, setV] = useState(String(r.price))
  const price = Math.round(+latin(v).replace(/\D/g, '')) || 0
  const low = price < r.base
  return (
    <Sheet title={r.name} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!low && price > 0) onSave({ price_override: price }) }}>
        <Field id="ps" label={`سعر البيع ${r.pack_qty ? `لل${packName(r.pack_qty)}` : 'للقطعة'} (د.ع)`}>
          <input id="ps" autoFocus inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} dir="ltr" aria-invalid={low}
            className={`${field} num min-h-16 text-start text-[26px] font-black`} />
        </Field>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-wash p-4"><p className="text-[13px] text-mute">سعره عليك</p><p className="num mt-1 text-[18px] font-extrabold">{iqd(r.base)}</p></div>
          <div className={`rounded-2xl p-4 ${low ? 'bg-[#fcefee]' : 'bg-brand-soft'}`} aria-live="polite">
            <p className={`text-[13px] ${low ? 'text-bad' : 'text-brand-deep'}`}>{low ? 'أقل من سعره عليك' : 'ربحك'}</p>
            <p className={`num mt-1 text-[18px] font-extrabold ${low ? 'text-bad' : 'text-brand-deep'}`}>{low ? '—' : iqd(price - r.base)}</p>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <Button variant="ink" type="submit" disabled={low || price <= 0}>حفظ</Button>
          {r.has_override && <Button variant="quiet" className="w-auto shrink-0 px-5" onClick={() => onSave({ price_override: null })}>السعر التلقائي</Button>}
        </div>
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------------
// منتجاتي الخاصة: يراجعها فريق الإدارة قبل ظهورها، وتوصيلها على صاحب المتجر
// ---------------------------------------------------------------------
const STATUS = { pending: ['بانتظار المراجعة', 'warn'], approved: ['معروض', 'ok'], rejected: ['مرفوض', 'bad'] }

/** قص الصورة مربعاً 800×800 وضغطها في المتصفح */
export async function squareImage(file, size = 800, type = 'image/jpeg') {
  const bmp = await createImageBitmap(file)
  const s = Math.min(bmp.width, bmp.height), c = Object.assign(document.createElement('canvas'), { width: size, height: size })
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size)
  g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size)
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('x'))), type, 0.86))
}

function Own({ store, flash }) {
  const [rows, setRows] = useState(null)
  const [fee, setFee] = useState(null)
  const [edit, setEdit] = useState(null)               // {} جديد، أو صف
  const [err, setErr] = useState(null)
  const load = () => Promise.all([
    q(sb.from('reseller_own_products').select('*').order('created_at', { ascending: false })),
    q(sb.from('reseller_stores').select('own_delivery_fee').eq('id', store.id).single()),
  ]).then(([p, s]) => { setRows(p); setFee(s.own_delivery_fee) }).catch((e) => setErr(errText(e)))
  useEffect(() => { load() }, [])

  if (err) return <Notice tone="bad">{err}</Notice>
  if (!rows) return <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div>
  return (
    <div>
      <p className="text-[15px] leading-7 text-ink-2">منتجات من عندك تبيعها في متجرك بجانب المنتجات الجاهزة. <b className="text-ink">توصيلها عليك</b>، ويراجعها فريقنا قبل أن تظهر للزبائن.</p>
      <FeeRow fee={fee} onSaved={(v) => { setFee(v); flash('حُفظت أجرة التوصيل') }} />
      <Button variant="ink" className="mt-6" onClick={() => setEdit({})}>إضافة منتج</Button>
      {rows.length === 0 ? <p className="py-12 text-center text-mute">لم تضف منتجات خاصة بعد.</p> : (
        <ul className="mt-6 divide-y hairline">
          {rows.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => setEdit(o)} className="flex w-full items-center gap-4 py-4 text-start">
                <Thumb src={ownImageUrl(o.image_path)} dim={!o.is_available} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[15px] font-medium leading-6">{o.name}</span>
                  <span className="num mt-1 block text-[16px] font-extrabold">{iqd(o.price)}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5"><Badge tone={STATUS[o.status][1]}>{STATUS[o.status][0]}</Badge>{!o.is_available && <Badge>غير متوفر</Badge>}</span>
                  {o.status === 'rejected' && o.reason && <span className="mt-1 block text-[13px] text-bad">{o.reason}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {edit && <OwnSheet o={edit} onClose={() => setEdit(null)} onDone={(msg) => { setEdit(null); flash(msg); load() }} />}
    </div>
  )
}

function FeeRow({ fee, onSaved }) {
  const [v, setV] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  if (v === null) {
    return (
      <div className="mt-5 flex items-center justify-between rounded-2xl bg-card px-5 py-4 ring-1 ring-line">
        <div><p className="text-[13px] text-mute">أجرة توصيل منتجاتك الخاصة</p><p className="num text-[17px] font-extrabold">{fee ? iqd(fee) : 'مجاناً'}</p></div>
        <button type="button" onClick={() => setV(String(fee ?? 0))} className="min-h-11 rounded-xl px-3 text-[14px] font-bold underline decoration-line decoration-2 underline-offset-8">تعديل</button>
      </div>
    )
  }
  const n = Math.round(+latin(v).replace(/\D/g, '')) || 0
  return (
    <form className="mt-5 rounded-2xl bg-card p-5 ring-1 ring-line" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null)
      try { await rpc('reseller_own_set_fee', { p_fee: n }); onSaved(n); setV(null) } catch (x) { setErr(errText(x)) } finally { setBusy(false) }
    }}>
      <Field id="fee" label="أجرة توصيل منتجاتك الخاصة (د.ع)" hint="يدفعها الزبون مرة واحدة لكل طلب. ضع 0 للتوصيل المجاني." error={err}>
        <input id="fee" autoFocus inputMode="numeric" dir="ltr" value={v} onChange={(e) => setV(e.target.value)} className={`${field} num text-start text-[18px] font-bold`} />
      </Field>
      <div className="mt-4 flex gap-3"><Button variant="ink" type="submit" disabled={busy}>حفظ</Button><Button variant="quiet" className="w-auto px-5" onClick={() => setV(null)}>إلغاء</Button></div>
    </form>
  )
}

function OwnSheet({ o, onClose, onDone }) {
  const [f, setF] = useState({ name: o.name ?? '', price: o.price ? String(o.price) : '', description: o.description ?? '', is_available: o.is_available ?? true })
  const [img, setImg] = useState(o.image_path ?? null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const file = useRef(null)
  const price = Math.round(+latin(f.price).replace(/\D/g, '')) || 0

  const upload = async (e) => {
    const x = e.target.files?.[0]; e.target.value = ''
    if (!x) return
    setBusy(true); setErr(null)
    try {
      const { data: u } = await sb.auth.getUser()
      const path = `${u.user.id}/${crypto.randomUUID().slice(0, 12)}.jpg`
      const { error } = await sb.storage.from('reseller-products').upload(path, await (await squareImage(x)).arrayBuffer(), { contentType: 'image/jpeg' })
      if (error) throw error
      setImg(path)
    } catch { setErr('تعذّر رفع الصورة. جرّب صورة أخرى.') } finally { setBusy(false) }
  }
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      await rpc('reseller_own_save', { p: { ...(o.id ? { id: o.id } : {}), name: f.name.trim(), price, description: f.description.trim(), image_path: img ?? '', is_available: f.is_available } })
      onDone(o.id ? 'حُفظ المنتج' : 'أُرسل المنتج للمراجعة')
    } catch (x) { setErr(errText(x)) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!confirm('حذف هذا المنتج نهائياً؟')) return
    setBusy(true)
    try { await rpc('reseller_own_delete', { p_id: o.id }); onDone('حُذف المنتج') } catch (x) { setErr(errText(x)); setBusy(false) }
  }
  return (
    <Sheet title={o.id ? 'تعديل منتج خاص' : 'منتج خاص جديد'} onClose={onClose}>
      <form onSubmit={save} className="space-y-5">
        {err && <Notice tone="bad">{err}</Notice>}
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => file.current.click()} disabled={busy} aria-label={img ? 'تغيير صورة المنتج' : 'رفع صورة المنتج'} className="relative size-24 shrink-0 overflow-hidden rounded-2xl bg-wash ring-1 ring-line">
            {img ? <img src={ownImageUrl(img)} alt="" className="size-full object-cover" /> : <span className="text-[13px] font-bold text-mute">صورة المنتج</span>}
          </button>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={upload} />
          <p className="text-[13px] leading-6 text-mute">صورة واضحة للمنتج وحده، بلا أشخاص. تُقصّ مربعاً تلقائياً.</p>
        </div>
        <Field id="on" label="اسم المنتج"><input id="on" className={field} value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field id="op" label="السعر (د.ع)"><input id="op" className={`${field} num text-start text-[18px] font-bold`} dir="ltr" inputMode="numeric" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        <Field id="od" label="وصف قصير (اختياري)"><textarea id="od" className={`${field} min-h-24 py-3`} rows={3} maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="flex min-h-13 items-center justify-between rounded-2xl bg-wash px-4">
          <span className="text-[15px] font-bold">متوفر للبيع</span>
          <input type="checkbox" className="size-5 accent-[var(--color-ink)]" checked={f.is_available} onChange={(e) => setF({ ...f, is_available: e.target.checked })} />
        </label>
        {o.id && <p className="text-[13px] leading-6 text-mute">تعديل الاسم أو السعر أو الصورة أو الوصف يعيد المنتج للمراجعة.</p>}
        <Button variant="ink" type="submit" disabled={busy || f.name.trim().length < 2 || price < 250}>{busy ? 'لحظة…' : o.id ? 'حفظ' : 'أرسل للمراجعة'}</Button>
        {o.id && <button type="button" onClick={remove} disabled={busy} className="min-h-12 w-full rounded-2xl text-[15px] font-bold text-bad">حذف المنتج</button>}
      </form>
    </Sheet>
  )
}
