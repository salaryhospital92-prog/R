import { useEffect, useState } from 'react'
import { Loader2, Search, Save, X, Pencil, Tags, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatIQD } from '../../lib/format'

/**
 * تسعير المنتجات. كل منتج بطاقة مستقلة تُقرأ فقط حتى تضغط «تعديل» —
 * يمنع التعديل بالخطأ، ويظهر زرّا «حفظ» و«إلغاء» للصف الجاري وحده.
 * سعر الجملة يُخزَّن للقطعة، ويُعرض معه سعر الدرزن (×12) لأنه لغة السوق.
 */
export default function Prices() {
  const [rows, setRows] = useState([])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)     // productId
  const [draft, setDraft] = useState({ retail: '', wholesale: '' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState(null)
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

  const startEdit = (r) => {
    setSavedId(null)
    setError('')
    setEditing(r.id)
    setDraft({
      retail: String(r.product_prices?.price_retail ?? 0),
      wholesale: String(r.product_prices?.price_wholesale ?? 0),
    })
  }

  const cancel = () => { setEditing(null); setDraft({ retail: '', wholesale: '' }) }

  const save = async (r) => {
    setBusy(true)
    setError('')
    const payload = {
      product_id: r.id,
      price_retail: Math.max(0, Number(draft.retail) || 0),
      price_wholesale: Math.max(0, Number(draft.wholesale) || 0),
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('product_prices').upsert(payload)
    if (error) setError('تعذّر الحفظ: ' + error.message)
    else {
      setRows((list) => list.map((x) => x.id === r.id
        ? { ...x, product_prices: { price_retail: payload.price_retail, price_wholesale: payload.price_wholesale } }
        : x))
      setSavedId(r.id)
      cancel()
    }
    setBusy(false)
  }

  const shown = rows.filter((r) => !query.trim() || r.name.includes(query.trim()))

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="size-7 animate-spin text-brand-600" /></div>
  }

  const field = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center text-sm font-bold tabular-nums focus:border-brand-500 focus:outline-none'

  return (
    <div>
      <h1 className="mb-1 flex items-center gap-2 text-lg font-extrabold">
        <Tags className="size-5 text-brand-600" /> الأسعار
      </h1>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        سعر الجملة يُدخل <b>للقطعة</b> ويظهر مقابله سعر الدرزن. اترك السعر 0 ليظهر
        المنتج في المتجر بـ«السعر عند الطلب».
      </p>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-slate-400" />
        <input
          value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم…"
          className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pe-3 ps-10 text-sm focus:border-brand-500 focus:outline-none"
        />
      </div>

      {error && <p className="mb-4 rounded-2xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {shown.length === 0 ? (
        <p className="card p-10 text-center text-sm text-slate-500">لا نتائج.</p>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {shown.map((r) => {
            const isEditing = editing === r.id
            const retail = r.product_prices?.price_retail ?? 0
            const wholesale = r.product_prices?.price_wholesale ?? 0

            return (
              <li key={r.id} className={`card p-4 transition ${isEditing ? 'ring-2 ring-brand-500' : ''}`}>
                <div className="mb-3 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold leading-snug">{r.name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{r.categories?.name ?? '—'}</p>
                  </div>
                  {savedId === r.id && (
                    <span className="animate-pop flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-[11px] font-bold text-brand-700">
                      <Check className="size-3.5" /> حُفظ
                    </span>
                  )}
                </div>

                {isEditing ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-bold text-slate-500">سعر المفرد</span>
                        <input
                          autoFocus inputMode="numeric" value={draft.retail}
                          onChange={(e) => setDraft({ ...draft, retail: e.target.value.replace(/\D/g, '') })}
                          className={field}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-bold text-slate-500">الجملة — للقطعة</span>
                        <input
                          inputMode="numeric" value={draft.wholesale}
                          onChange={(e) => setDraft({ ...draft, wholesale: e.target.value.replace(/\D/g, '') })}
                          className={field}
                        />
                      </label>
                    </div>

                    <p className="mt-2 text-center text-[11px] text-slate-500">
                      الدرزن = <b className="text-slate-700">{formatIQD((Number(draft.wholesale) || 0) * 12)}</b>
                    </p>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => save(r)} disabled={busy}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-sm font-bold text-white transition active:scale-95 hover:bg-brand-700 disabled:opacity-60"
                      >
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} حفظ
                      </button>
                      <button
                        onClick={cancel} disabled={busy}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-700 transition active:scale-95 hover:bg-slate-200"
                      >
                        <X className="size-4" /> إلغاء
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-xl bg-slate-50 p-2.5">
                        <p className="text-[11px] text-slate-500">المفرد</p>
                        <p className={`text-sm font-extrabold tabular-nums ${retail ? 'text-brand-700' : 'text-amber-600'}`}>
                          {retail ? formatIQD(retail) : 'عند الطلب'}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-2.5">
                        <p className="text-[11px] text-slate-500">الجملة — للقطعة</p>
                        <p className={`text-sm font-extrabold tabular-nums ${wholesale ? 'text-brand-700' : 'text-amber-600'}`}>
                          {wholesale ? formatIQD(wholesale) : 'عند الطلب'}
                        </p>
                        {wholesale > 0 && (
                          <p className="text-[10px] text-slate-400">الدرزن {formatIQD(wholesale * 12)}</p>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => startEdit(r)}
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white transition active:scale-95 hover:bg-slate-800"
                    >
                      <Pencil className="size-4" /> تعديل
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
