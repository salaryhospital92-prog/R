import { useEffect, useState } from 'react'
import { Loader2, Search, Save, X, Pencil, Tags, Check, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatIQD } from '../../lib/format'

/**
 * تسعير المنتجات.
 *
 * سعر المفرد دائماً «للقطعة» — لا وحدة له تُختار، هذا تعريفه.
 * سعر الجملة له وحدة صريحة **محفوظة لكل منتج** (`products.price_unit`):
 * إمّا ثمن الدرزن (12 قطعة) أو ثمن القطعة. كانت الوحدة تُشتقّ ضمناً من
 * وحدة البيع، فمن بيده سعر القطعة لمنتج يُباع بالدرزن لم يجد إلا خانة
 * معنونة «سعر الدرزن» — فنشأت أخطاء الضرب في 12.
 *
 * التخزين لا يتغيّر: `price_wholesale` يبقى سعر القطعة دائماً، والوحدة
 * وصفٌ للإدخال والعرض فقط.
 */
export default function Prices() {
  const [rows, setRows] = useState([])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({ retail: '', wholesale: '', unit: 'dozen' })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('products')
      .select('id, name, sold_by, price_unit, categories(name), product_prices(price_retail, price_wholesale)')
      .order('name')
      .then(({ data, error }) => {
        if (error) setError('تعذّر التحميل: ' + error.message)
        setRows(data ?? [])
        setLoading(false)
      })
  }, [])

  const perPiece = (r) => r.product_prices?.price_wholesale ?? 0
  const inUnit = (pieceValue, unit) => (unit === 'dozen' ? pieceValue * 12 : pieceValue)
  const toPiece = (entered, unit) => (unit === 'dozen' ? Math.round(entered / 12) : Math.round(entered))

  const startEdit = (r) => {
    setSavedId(null)
    setError('')
    setEditing(r.id)
    const unit = r.price_unit ?? 'dozen'
    setDraft({
      retail: String(r.product_prices?.price_retail ?? 0),
      wholesale: String(inUnit(perPiece(r), unit)),
      unit,
    })
  }

  const cancel = () => { setEditing(null); setDraft({ retail: '', wholesale: '', unit: 'dozen' }) }

  /** تبديل الوحدة يحوّل الرقم ولا يغيّر السعر الحقيقي */
  const switchUnit = (unit) => {
    if (unit === draft.unit) return
    const piece = toPiece(Number(draft.wholesale) || 0, draft.unit)
    setDraft({ ...draft, unit, wholesale: String(inUnit(piece, unit)) })
  }

  const save = async (r) => {
    setBusy(true)
    setError('')
    const entered = Math.max(0, Number(draft.wholesale) || 0)
    const priceWholesale = toPiece(entered, draft.unit)

    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('product_prices').upsert({
        product_id: r.id,
        price_retail: Math.max(0, Math.round(Number(draft.retail) || 0)),
        price_wholesale: priceWholesale,
        updated_at: new Date().toISOString(),
      }),
      supabase.from('products').update({ price_unit: draft.unit }).eq('id', r.id),
    ])

    if (e1 || e2) setError('تعذّر الحفظ: ' + (e1 ?? e2).message)
    else {
      setRows((list) => list.map((x) => x.id === r.id
        ? {
            ...x, price_unit: draft.unit,
            product_prices: {
              price_retail: Math.max(0, Math.round(Number(draft.retail) || 0)),
              price_wholesale: priceWholesale,
            },
          }
        : x))
      setSavedId(r.id)
      cancel()
    }
    setBusy(false)
  }

  const shown = rows.filter((r) => !query.trim() || r.name.includes(query.trim()))

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="size-7 animate-spin text-brand-700" /></div>
  }

  const field = 'w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-center text-sm font-bold tabular-nums focus:border-brand-500 focus:outline-none'

  return (
    <div>
      <h1 className="mb-1 flex items-center gap-2 text-lg font-extrabold">
        <Tags className="size-5 text-brand-700" /> الأسعار
      </h1>
      <p className="mb-4 text-xs leading-relaxed text-ink-600">
        سعر المفرد دائماً <b>للقطعة</b>. أما سعر الجملة فاختر وحدته بنفسك:
        <b> سعر الدرزن</b> (12 قطعة) أو <b>سعر القطعة</b> — والوحدة تُحفظ لكل منتج
        فتظهر كما أدخلتها في كل مرة. اترك السعر 0 ليظهر بـ«السعر عند الطلب».
      </p>

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute inset-y-0 start-3.5 my-auto size-4 text-ink-600" />
        <input
          value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم…"
          className="w-full rounded-2xl border border-ink-200 bg-white py-2.5 pe-3 ps-10 text-sm focus:border-brand-500 focus:outline-none"
        />
      </div>

      {error && <p role="alert" className="mb-4 rounded-2xl bg-red-50 p-3 text-sm text-danger-700">{error}</p>}

      {shown.length === 0 ? (
        <p className="surface p-10 text-center text-sm text-ink-600">لا نتائج.</p>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {shown.map((r) => {
            const isEditing = editing === r.id
            const retail = r.product_prices?.price_retail ?? 0
            const piece = perPiece(r)
            const unit = r.price_unit ?? 'dozen'

            // القيمتان محسوبتان دائماً من الرقم المكتوب ووحدته — لا رقم بلا وحدة
            const draftPiece = toPiece(Number(draft.wholesale) || 0, draft.unit)
            const inverted = draftPiece > 0 && Number(draft.retail) > 0 && draftPiece >= Number(draft.retail)

            return (
              <li key={r.id} className={`surface-raised p-4 transition ${isEditing ? 'ring-2 ring-brand-700' : ''}`}>
                <div className="mb-3 flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold leading-snug">{r.name}</p>
                    <p className="mt-0.5 text-[11px] text-ink-600">{r.categories?.name ?? '—'}</p>
                  </div>
                  {savedId === r.id && (
                    <span className="animate-pop flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-[11px] font-bold text-brand-800">
                      <Check className="size-3.5" /> حُفظ
                    </span>
                  )}
                </div>

                {isEditing ? (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-bold text-ink-600">سعر المفرد — للقطعة</span>
                      <input
                        autoFocus inputMode="numeric" value={draft.retail}
                        onChange={(e) => setDraft({ ...draft, retail: e.target.value.replace(/\D/g, '') })}
                        className={field}
                      />
                    </label>

                    <div className="mt-3">
                      <span className="mb-1 block text-[11px] font-bold text-ink-600">
                        سعر الجملة — الرقم الذي ستكتبه هو:
                      </span>
                      <div role="group" aria-label="وحدة سعر الجملة" className="mb-2 flex gap-1 rounded-xl bg-ink-100 p-1">
                        {[
                          { v: 'dozen', t: 'سعر الدرزن', s: '12 قطعة' },
                          { v: 'piece', t: 'سعر القطعة', s: 'قطعة واحدة' },
                        ].map((u) => (
                          <button
                            key={u.v} type="button" onClick={() => switchUnit(u.v)}
                            aria-pressed={draft.unit === u.v}
                            className={`flex-1 rounded-lg py-2 text-[13px] font-extrabold transition ${
                              draft.unit === u.v ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900'
                            }`}
                          >
                            {u.t}
                            <span className="block text-[10px] font-bold opacity-70">{u.s}</span>
                          </button>
                        ))}
                      </div>
                      <input
                        inputMode="numeric" value={draft.wholesale}
                        onChange={(e) => setDraft({ ...draft, wholesale: e.target.value.replace(/\D/g, '') })}
                        aria-label={draft.unit === 'dozen' ? 'سعر الدرزن' : 'سعر القطعة بالجملة'}
                        className={field}
                      />
                    </div>

                    {/* القيمتان معاً دائماً — لا يبقى رقم مجهول الوحدة */}
                    <p className="mt-2 rounded-lg bg-brand-50 px-2 py-1.5 text-center text-[11px] font-bold text-brand-900">
                      الدرزن {formatIQD(draftPiece * 12)} · القطعة {formatIQD(draftPiece)}
                    </p>

                    {inverted && (
                      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-bold text-warn-600">
                        <AlertTriangle className="mt-px size-3.5 shrink-0" />
                        سعر الجملة للقطعة ليس أقل من سعر المفرد — تأكّد من الوحدة المختارة.
                      </p>
                    )}

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => save(r)} disabled={busy}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-brand-700 py-2.5 text-sm font-bold text-white transition active:scale-95 hover:bg-brand-800 disabled:opacity-60"
                      >
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} حفظ
                      </button>
                      <button
                        onClick={cancel} disabled={busy}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-ink-100 py-2.5 text-sm font-bold text-ink-700 transition active:scale-95 hover:bg-ink-200"
                      >
                        <X className="size-4" /> إلغاء
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-xl bg-ink-50 p-2.5">
                        <p className="text-[11px] text-ink-600">المفرد · للقطعة</p>
                        <p className={`text-sm font-extrabold tabular-nums ${retail ? 'text-brand-800' : 'text-warn-600'}`}>
                          {retail ? formatIQD(retail) : 'عند الطلب'}
                        </p>
                      </div>
                      <div className="rounded-xl bg-ink-50 p-2.5">
                        {/* شارة الوحدة: تعرف بنظرة أي سعر تنظر إليه */}
                        <p className="flex items-center justify-center gap-1 text-[11px] text-ink-600">
                          الجملة
                          <span className="rounded-full bg-ink-200 px-1.5 py-px text-[10px] font-extrabold text-ink-800">
                            {unit === 'dozen' ? 'درزن' : 'قطعة'}
                          </span>
                        </p>
                        <p className={`text-sm font-extrabold tabular-nums ${piece ? 'text-brand-800' : 'text-warn-600'}`}>
                          {piece ? formatIQD(inUnit(piece, unit)) : 'عند الطلب'}
                        </p>
                        {piece > 0 && (
                          <p className="text-[10px] text-ink-600">
                            {unit === 'dozen' ? `القطعة ${formatIQD(piece)}` : `الدرزن ${formatIQD(piece * 12)}`}
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => startEdit(r)}
                      className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-ink-900 py-2.5 text-sm font-bold text-white transition active:scale-95 hover:bg-ink-800"
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
