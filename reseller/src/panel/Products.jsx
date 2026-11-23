import { useEffect, useMemo, useState } from 'react'
import { EyeOff, Search, X } from 'lucide-react'
import { errText } from '../lib/config'
import { iqd, latin, norm } from '../lib/format'
import { packName } from '../lib/qty'
import { Button, Notice } from '../ui'
import { q, rpc, sb } from './sb'

const PAGE = 40
const Thumb = ({ p, dim }) => (
  <span className={`relative block size-14 shrink-0 overflow-hidden rounded-xl bg-stone-100 ${dim ? 'opacity-40' : ''}`}>
    {p.image_url && <img src={p.image_url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="size-full object-cover" />}
  </span>
)

/** المنتجات: لمسة على الصورة تُظهر/تُخفي، ولمسة على السطر تفتح تعديل السعر بخانة واحدة والربح يظهر تحتها فوراً */
export default function Products({ store, flash }) {
  const [rows, setRows] = useState(null)
  const [filter, setFilter] = useState({ q: '', cat: 0, hidden: false })
  const [more, setMore] = useState(PAGE)
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState(null)

  const load = () => rpc('reseller_catalog').then((r) => setRows(r.filter((x) => x.base > 0))).catch((e) => setErr(errText(e)))
  useEffect(() => { load() }, [])

  const cats = useMemo(() => [...new Map((rows ?? []).map((r) => [r.category_id, r.category]))].sort((a, b) => a[1].localeCompare(b[1], 'ar')), [rows])
  const list = useMemo(() => {
    const t = norm(filter.q).trim()
    return (rows ?? []).filter((r) => (!filter.cat || r.category_id === filter.cat) && (!filter.hidden || !r.is_visible) && (!t || norm(r.name).includes(t)))
  }, [rows, filter])

  /** يحفظ ويعيد التحميل. prev: ما نعود إليه عند «تراجع» */
  const save = async (r, patch, prev, msg) => {
    try {
      await q(sb.from('reseller_products').upsert({ store_id: store.id, product_id: r.product_id, ...patch }, { onConflict: 'store_id,product_id' }))
      await load()
      flash(msg, { label: 'تراجع', run: async () => { try { await q(sb.from('reseller_products').upsert({ store_id: store.id, product_id: r.product_id, ...prev }, { onConflict: 'store_id,product_id' })); await load() } catch (e) { flash(errText(e)) } } })
    } catch (e) { flash(e?.code === '42501' || /row-level/.test(e?.message ?? '') ? 'لا يمكن التعديل الآن (المتجر موقوف)' : errText(e)) }
  }
  const unit = (r) => (r.pack_qty ? `لل${packName(r.pack_qty)} (${r.pack_qty} قطعة)` : 'للقطعة')
  const set = (patch) => { setFilter({ ...filter, ...patch }); setMore(PAGE) }

  if (err) return <Notice>{err}</Notice>
  if (!rows) return <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div>

  return (
    <div>
      <label className="relative block"><span className="sr-only">ابحث عن منتج</span>
        <Search className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-stone-400" aria-hidden="true" />
        <input type="search" value={filter.q} onChange={(e) => set({ q: e.target.value })} placeholder="ابحث عن منتج"
          className="h-12 w-full rounded-2xl bg-stone-100 pe-4 ps-11 outline-none focus:bg-white focus:ring-2 focus:ring-brand" /></label>
      <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <button type="button" onClick={() => set({ hidden: !filter.hidden })} aria-pressed={filter.hidden}
          className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] font-medium ${filter.hidden ? 'bg-stone-800 text-white' : 'bg-stone-100'}`}><EyeOff className="size-4" aria-hidden="true" />المخفية</button>
        {[[0, 'الكل'], ...cats].map(([id, name]) => (
          <button key={id} type="button" onClick={() => set({ cat: id })} aria-pressed={filter.cat === id}
            className={`min-h-11 shrink-0 rounded-full px-4 text-[15px] font-medium ${filter.cat === id ? 'bg-brand text-brand-ink' : 'bg-stone-100 text-stone-700'}`}>{name}</button>
        ))}
      </div>
      <p className="mt-3 text-sm text-stone-500">المس الصورة لإخفاء المنتج أو إظهاره، والمس السطر لتعديل سعره.</p>

      <ul className="mt-2 divide-y divide-stone-100">
        {list.slice(0, more).map((r) => (
          <li key={r.product_id} className="flex items-center gap-3 py-3">
            <button type="button" aria-label={r.is_visible ? `إخفاء ${r.name}` : `إظهار ${r.name}`} aria-pressed={r.is_visible}
              onClick={() => save(r, { is_visible: !r.is_visible }, { is_visible: r.is_visible }, r.is_visible ? 'أُخفي من متجرك' : 'ظهر في متجرك')}>
              <Thumb p={r} dim={!r.is_visible} />
            </button>
            <button type="button" onClick={() => setEdit(r)} className={`min-w-0 flex-1 text-start ${r.is_visible ? '' : 'opacity-50'}`}>
              <span className="line-clamp-2 text-[15px] font-medium leading-6">{r.name}</span>
              <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                <b className="tabular-nums">{iqd(r.price)}</b>
                <span className="text-sm font-bold text-brand-deep tabular-nums">ربحك {iqd(r.profit)}</span>
              </span>
              <span className="text-[13px] text-stone-500">{unit(r)}{r.has_override ? ' · سعر مخصّص' : ''}{!r.is_visible ? ' · مخفي' : ''}{!r.in_stock ? ' · نفد' : ''}</span>
            </button>
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="py-12 text-center text-stone-500">لا منتجات مطابقة</p>}
      {list.length > more && <button type="button" onClick={() => setMore(more + PAGE)} className="mt-4 min-h-12 w-full rounded-2xl bg-stone-100 font-bold">عرض المزيد</button>}
      {edit && <PriceSheet r={edit} onClose={() => setEdit(null)} onSave={(patch) => { const r = edit; setEdit(null); save(r, patch, { price_override: r.has_override ? r.price : null }, patch.price_override ? 'حُفظ السعر' : 'عاد السعر تلقائياً') }} />}
    </div>
  )
}

function PriceSheet({ r, onClose, onSave }) {
  const [v, setV] = useState(String(r.price))
  const price = Math.round(+latin(v).replace(/\D/g, '')) || 0
  const low = price < r.base
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose} role="dialog" aria-modal="true" aria-label={`سعر ${r.name}`}>
      <form className="rise mx-auto w-full max-w-2xl rounded-t-3xl bg-white p-5 safe-b" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (!low && price > 0) onSave({ price_override: price }) }}>
        <div className="flex items-start justify-between gap-3"><h2 className="text-lg font-extrabold leading-7">{r.name}</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="-m-2 grid size-11 shrink-0 place-items-center"><X className="size-5" /></button></div>
        <label className="mt-4 block"><span className="mb-1.5 block text-[15px] font-bold">سعر البيع {r.pack_qty ? `لل${packName(r.pack_qty)}` : 'للقطعة'} (د.ع)</span>
          <input autoFocus inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} dir="ltr"
            className={`min-h-14 w-full rounded-2xl bg-stone-100 px-4 text-start text-2xl font-extrabold tabular-nums outline-none focus:ring-2 ${low ? 'ring-2 ring-red-500' : 'focus:ring-brand'}`} /></label>
        <p className={`mt-3 text-lg font-bold ${low ? 'text-red-600' : 'text-brand-deep'}`} aria-live="polite">
          {low ? `لا يمكن أقل من ${iqd(r.base)} (سعره عليك)` : `ربحك: ${iqd(price - r.base)}`}</p>
        <p className="text-sm text-stone-500">سعره عليك: {iqd(r.base)}</p>
        <div className="mt-5 flex gap-3">
          <Button type="submit" disabled={low || price <= 0} className="flex-1">حفظ</Button>
          {r.has_override && <button type="button" onClick={() => onSave({ price_override: null })} className="min-h-12 shrink-0 rounded-2xl bg-stone-100 px-4 font-bold">السعر التلقائي</button>}
        </div>
      </form>
    </div>
  )
}
