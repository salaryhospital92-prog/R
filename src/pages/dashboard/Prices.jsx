import { useEffect, useState } from 'react'
import { Loader2, Search, Save, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'

/** تسعير جماعي سريع — أسرع من فتح كل منتج على حدة */
export default function Prices() {
  const [rows, setRows] = useState([])
  const [edits, setEdits] = useState({})     // { productId: {retail, wholesale} }
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('products')
      .select('id, name, categories(name), product_prices(price_retail, price_wholesale)')
      .order('name')
      .then(({ data, error }) => {
        if (error) setError('تعذّر التحميل: ' + error.message)
        setRows(data ?? [])
        setLoading(false)
      })
  }, [])

  const valueOf = (r, key) =>
    edits[r.id]?.[key] ?? String(r.product_prices?.[key] ?? 0)

  const edit = (id, key, value) => {
    setSaved(false)
    setEdits((e) => ({ ...e, [id]: { ...e[id], [key]: value.replace(/\D/g, '') } }))
  }

  const save = async () => {
    setBusy(true)
    setError('')
    const payload = Object.entries(edits).map(([product_id, v]) => {
      const row = rows.find((r) => r.id === product_id)
      return {
        product_id,
        price_retail: Number(v.price_retail ?? row.product_prices?.price_retail ?? 0),
        price_wholesale: Number(v.price_wholesale ?? row.product_prices?.price_wholesale ?? 0),
        updated_at: new Date().toISOString(),
      }
    })
    const { error } = await supabase.from('product_prices').upsert(payload)
    if (error) setError('تعذّر الحفظ: ' + error.message)
    else {
      setRows((list) => list.map((r) => {
        const p = payload.find((x) => x.product_id === r.id)
        return p ? { ...r, product_prices: { price_retail: p.price_retail, price_wholesale: p.price_wholesale } } : r
      }))
      setEdits({})
      setSaved(true)
    }
    setBusy(false)
  }

  const shown = rows.filter((r) => !query.trim() || r.name.includes(query.trim()))
  const dirty = Object.keys(edits).length

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="size-7 animate-spin text-brand-600" /></div>
  }

  const input = 'w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm text-center focus:border-brand-500 focus:outline-none'

  return (
    <div className="pb-24">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-extrabold">الأسعار</h1>
        <div className="relative ms-auto min-w-52 flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-slate-400" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم…"
            className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pe-3 ps-9 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>
      </div>

      <p className="mb-3 text-xs text-slate-500">
        اترك السعر 0 ليظهر المنتج في المتجر بـ«السعر عند الطلب». كل المبالغ بالدينار العراقي.
      </p>

      {error && <p className="mb-4 rounded-2xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="card overflow-hidden">
        <div className="grid grid-cols-[1fr_5.5rem_5.5rem] gap-2 border-b border-slate-100 px-3 py-2.5 text-[11px] font-bold text-slate-500">
          <span>المنتج</span><span className="text-center">مفرد</span><span className="text-center">جملة</span>
        </div>

        {shown.map((r) => (
          <div key={r.id} className="grid grid-cols-[1fr_5.5rem_5.5rem] items-center gap-2 border-b border-slate-50 px-3 py-2 last:border-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{r.name}</p>
              <p className="truncate text-[11px] text-slate-400">{r.categories?.name}</p>
            </div>
            <input inputMode="numeric" value={valueOf(r, 'price_retail')}
                   onChange={(e) => edit(r.id, 'price_retail', e.target.value)} className={input} />
            <input inputMode="numeric" value={valueOf(r, 'price_wholesale')}
                   onChange={(e) => edit(r.id, 'price_wholesale', e.target.value)} className={input} />
          </div>
        ))}

        {shown.length === 0 && <p className="p-8 text-center text-sm text-slate-500">لا نتائج.</p>}
      </div>

      {(dirty > 0 || saved) && (
        <div className="glass fixed inset-x-0 bottom-0 z-30 p-3">
          <button
            onClick={save} disabled={busy || dirty === 0}
            className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 font-bold text-white disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-5 animate-spin" />
              : saved && dirty === 0 ? <Check className="size-5" /> : <Save className="size-5" />}
            {saved && dirty === 0 ? 'تم الحفظ' : `حفظ ${dirty} منتج`}
          </button>
        </div>
      )}
    </div>
  )
}
