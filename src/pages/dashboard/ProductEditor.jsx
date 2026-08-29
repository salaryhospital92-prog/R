import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import {
  ScanLine, Camera, Loader2, Save, ArrowRight, Trash2, ImageOff, Boxes, Images, Search,
  ScanSearch, Link as LinkIcon,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatNumber, totalUnits } from '../../lib/format'
import { uploadProductImage, deleteProductImage, fetchImageFromUrl } from '../../lib/image'
import { googleImages, googleLens } from '../../lib/search'
import { useAuth } from '../../context/AuthContext'

// html5-qrcode مكتبة ثقيلة (~400KB) — تُحمَّل عند فتح الماسح فقط
const BarcodeScanner = lazy(() => import('../../components/BarcodeScanner'))

export default function ProductEditor() {
  const { id } = useParams()
  const isNew = id === 'new'
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const cameraInput = useRef(null)
  const galleryInput = useRef(null)

  const [categories, setCategories] = useState([])
  const [form, setForm] = useState({
    barcode: params.get('barcode') ?? '',
    name: '',
    category_id: '',
    image_url: '',
    quantity_single: 0,
    sold_by: 'dozen',
  })
  const [prices, setPrices] = useState({ price_retail: '', price_wholesale: '' })
  const [dozens, setDozens] = useState('')
  const [singles, setSingles] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [fetching, setFetching] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [loading, setLoading] = useState(!isNew)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const added = totalUnits(dozens, singles)

  useEffect(() => {
    supabase.from('categories').select('id, name').order('sort_order')
      .then(({ data }) => setCategories(data ?? []))
  }, [])

  useEffect(() => {
    if (isNew) return
    const select = isAdmin
      ? 'id, barcode, name, category_id, image_url, quantity_single, sold_by, product_prices(price_retail, price_wholesale)'
      : 'id, barcode, name, category_id, image_url, quantity_single, sold_by'

    supabase.from('products').select(select).eq('id', id).maybeSingle().then(({ data, error }) => {
      if (error || !data) {
        setError('المنتج غير موجود')
      } else {
        setForm({
          barcode: data.barcode ?? '',
          name: data.name,
          category_id: data.category_id ? String(data.category_id) : '',
          image_url: data.image_url ?? '',
          quantity_single: data.quantity_single,
          sold_by: data.sold_by ?? 'dozen',
        })
        if (data.product_prices) {
          setPrices({
            price_retail: String(data.product_prices.price_retail ?? 0),
            price_wholesale: String(data.product_prices.price_wholesale ?? 0),
          })
        }
      }
      setLoading(false)
    })
  }, [id, isNew, isAdmin])

  const pickImage = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setPreview(URL.createObjectURL(file))
  }

  // إرفاق صورة من رابط خارجي — تُجلب عبر وسيط الخادم لتجاوز حجب CORS
  const grabFromUrl = async () => {
    setFetching(true)
    setError('')
    try {
      const file = await fetchImageFromUrl(imageUrl.trim())
      setImageFile(file)
      setPreview(URL.createObjectURL(file))
      setImageUrl('')
    } catch (err) {
      setError(err.message ?? 'تعذّر جلب الصورة')
    } finally {
      setFetching(false)
    }
  }

  const save = async (e) => {
    e.preventDefault()
    setError('')
    setDone('')
    if (!form.name.trim()) return setError('اسم المنتج مطلوب')
    if (!form.category_id) return setError('اختر الصنف')
    setBusy(true)

    try {
      const row = {
        barcode: form.barcode.trim() || null,
        name: form.name.trim(),
        category_id: Number(form.category_id),
        sold_by: form.sold_by,
      }

      let productId = id
      if (isNew) {
        const { data, error } = await supabase.from('products').insert(row).select('id').single()
        if (error) throw error
        productId = data.id
      } else {
        const { error } = await supabase.from('products').update(row).eq('id', id)
        if (error) throw error
      }

      if (imageFile) {
        const url = await uploadProductImage(imageFile, productId)
        const { error } = await supabase.from('products').update({ image_url: url }).eq('id', productId)
        if (error) throw error
      }

      // الكمية لا تُكتب مباشرة — تمرّ عبر سجل الحركات ليبقى التدقيق كاملاً
      if (added !== 0) {
        const { error } = await supabase.from('stock_movements').insert({
          product_id: productId,
          type: 'stock_in',
          dozen_qty: Number(dozens) || 0,
          singles_qty: Number(singles) || 0,
        })
        if (error) throw error
      }

      if (isAdmin && (prices.price_retail !== '' || prices.price_wholesale !== '')) {
        const { error } = await supabase.from('product_prices').upsert({
          product_id: productId,
          price_retail: Math.max(0, Math.round(Number(prices.price_retail) || 0)),
          price_wholesale: Math.max(0, Math.round(Number(prices.price_wholesale) || 0)),
          updated_at: new Date().toISOString(),
        })
        if (error) throw error
      }

      if (isNew) return navigate('/dashboard')
      setDone(added !== 0 ? `تمت الإضافة — ${formatNumber(added)} قطعة` : 'تم الحفظ')
      setForm((f) => ({ ...f, quantity_single: f.quantity_single + added }))
      setDozens('')
      setSingles('')
      setImageFile(null)
    } catch (err) {
      setError(err.message ?? 'حدث خطأ غير متوقع')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('حذف هذا المنتج نهائياً؟')) return
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) return setError('تعذّر الحذف: ' + error.message)
    await deleteProductImage(id)   // حتى لا تبقى الصورة تشغل مساحة بلا منتج
    navigate('/dashboard')
  }

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="size-7 animate-spin text-brand-700" /></div>
  }

  const field = 'w-full rounded-xl border border-ink-200 px-3 py-2 focus:border-brand-500 focus:outline-none'
  const label = 'block text-sm font-semibold mb-1'

  return (
    <form onSubmit={save} className="mx-auto max-w-lg">
      <div className="mb-4 flex items-center gap-2">
        <Link to="/dashboard" className="rounded-lg p-1.5 hover:bg-ink-100" aria-label="رجوع">
          <ArrowRight className="size-5" />
        </Link>
        <h1 className="text-lg font-bold">{isNew ? 'منتج جديد' : 'تعديل المنتج'}</h1>
        {!isNew && isAdmin && (
          <button type="button" onClick={remove} className="ms-auto flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-danger-700 hover:bg-red-50">
            <Trash2 className="size-4" /> حذف
          </button>
        )}
      </div>

      <div className="grid gap-4 rounded-2xl bg-white p-4">
        <div>
          <label className={label} htmlFor="barcode">الباركود</label>
          <div className="flex gap-2">
            <input
              id="barcode" dir="ltr" value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              placeholder="امسح أو اكتب يدوياً"
              className={field + ' text-start'}
            />
            <button type="button" onClick={() => setScanning(true)} className="shrink-0 rounded-xl bg-ink-800 px-3 text-white hover:bg-ink-900" aria-label="مسح">
              <ScanLine className="size-5" />
            </button>
          </div>
        </div>

        <div>
          <label className={label} htmlFor="name">اسم المنتج *</label>
          <input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
        </div>

        <div>
          <label className={label} htmlFor="category">الصنف *</label>
          <select id="category" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className={field}>
            <option value="">— اختر الصنف —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <span className={label}>وحدة البيع</span>
          <div className="grid grid-cols-2 gap-2">
            {[
              { v: 'dozen', t: 'بالدرزن والقطعة', s: 'الجملة تُحسب بالدرزن' },
              { v: 'piece', t: 'بالقطعة فقط', s: 'لا يُباع بالدرزن' },
            ].map((o) => (
              <button
                key={o.v} type="button" onClick={() => setForm({ ...form, sold_by: o.v })}
                className={`rounded-xl border-2 p-2.5 text-start transition ${
                  form.sold_by === o.v ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-white'
                }`}
              >
                <span className="block text-sm font-bold">{o.t}</span>
                <span className="block text-[11px] text-ink-600">{o.s}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className={label}>صورة المنتج</span>
          <div className="flex items-center gap-3">
            {preview || form.image_url ? (
              <img src={preview || form.image_url} alt="" className="size-20 rounded-xl object-cover" />
            ) : (
              <span className="flex size-20 items-center justify-center rounded-xl bg-ink-100">
                <ImageOff className="size-6 text-ink-600" />
              </span>
            )}
            {/* capture يفتح الكاميرا مباشرة، وبدونه يفتح المعرض وأي مصدر صور آخر */}
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" onChange={pickImage} className="hidden" />
            <input ref={galleryInput} type="file" accept="image/*" onChange={pickImage} className="hidden" />
            <div className="grid flex-1 grid-cols-2 gap-2">
              <button type="button" onClick={() => cameraInput.current?.click()}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-ink-100 px-3 py-2.5 text-sm font-bold hover:bg-ink-200">
                <Camera className="size-4" /> كاميرا
              </button>
              <button type="button" onClick={() => galleryInput.current?.click()}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-ink-100 px-3 py-2.5 text-sm font-bold hover:bg-ink-200">
                <Images className="size-4" /> المعرض
              </button>
            </div>
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {form.image_url && (
              <a
                href={googleLens(form.image_url)}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-50 py-2.5 text-sm font-bold text-warn-600 hover:bg-amber-100"
              >
                <ScanSearch className="size-4" /> عدسة جوجل — تعرّف على المنتج
              </a>
            )}
            {(form.name.trim() || form.barcode.trim()) && (
              <a
                href={googleImages(form.barcode.trim() || form.name.trim())}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-xl bg-blue-50 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
              >
                <Search className="size-4" /> صور المنتج في جوجل
              </a>
            )}
          </div>

          {/* إرفاق صورة من رابط: تُجلب عبر الخادم ثم تُصغَّر كأي صورة أخرى */}
          <div className="mt-2 flex gap-2">
            <input
              value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} dir="ltr"
              placeholder="أو الصق رابط صورة هنا…"
              className={field + ' text-start text-xs'}
            />
            <button
              type="button" onClick={grabFromUrl} disabled={fetching || !imageUrl.trim()}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-ink-900 px-3 text-sm font-bold text-white disabled:opacity-40"
            >
              {fetching ? <Loader2 className="size-4 animate-spin" /> : <LinkIcon className="size-4" />} جلب
            </button>
          </div>

          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-600">
            صوّر المنتج واحفظه، ثم افتح <b>عدسة جوجل</b> لتتعرّف عليه وتريك صوره
            الرسمية. انسخ رابط الصورة الأوضح والصقه هنا ليحلّ محلّ صورتك.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-2xl bg-white p-4">
        <div className="flex items-center gap-2 font-semibold">
          <Boxes className="size-5 text-brand-700" />
          {isNew ? 'الكمية الأولى' : 'إضافة كمية'}
          {!isNew && (
            <span className="ms-auto text-sm font-normal text-ink-600">
              الرصيد الحالي: {formatNumber(form.quantity_single)} قطعة
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label} htmlFor="dozens">درزن</label>
            <input id="dozens" type="number" min="0" inputMode="numeric" value={dozens} onChange={(e) => setDozens(e.target.value)} placeholder="0" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="singles">مفرد</label>
            <input id="singles" type="number" min="0" inputMode="numeric" value={singles} onChange={(e) => setSingles(e.target.value)} placeholder="0" className={field} />
          </div>
        </div>

        <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900">
          الإجمالي المضاف: {formatNumber(added)} قطعة
          <span className="font-normal text-brand-700"> ({formatNumber(Number(dozens) || 0)} × ١٢ + {formatNumber(Number(singles) || 0)})</span>
        </p>
      </div>

      {isAdmin && (
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-white p-4">
          <p className="col-span-2 text-sm font-semibold">الأسعار (د.ع) — تظهر للمدير فقط</p>
          <div>
            <label className={label} htmlFor="retail">سعر المفرد</label>
            <input id="retail" type="number" min="0" inputMode="numeric" value={prices.price_retail} onChange={(e) => setPrices({ ...prices, price_retail: e.target.value })} placeholder="0" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="wholesale">سعر الجملة</label>
            <input id="wholesale" type="number" min="0" inputMode="numeric" value={prices.price_wholesale} onChange={(e) => setPrices({ ...prices, price_wholesale: e.target.value })} placeholder="0" className={field} />
          </div>
          <p className="col-span-2 text-xs text-ink-600">اتركه 0 ليظهر في المتجر بـ«السعر عند الطلب».</p>
        </div>
      )}

      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-danger-700">{error}</p>}
      {done && <p className="mt-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-900">{done}</p>}

      <button
        type="submit" disabled={busy}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 py-3 font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : <Save className="size-5" />}
        {isNew ? 'حفظ المنتج' : 'حفظ التغييرات'}
      </button>

      {scanning && (
        <Suspense fallback={null}>
          <BarcodeScanner
            onScan={(code) => { setForm((f) => ({ ...f, barcode: code })); setScanning(false) }}
            onClose={() => setScanning(false)}
          />
        </Suspense>
      )}
    </form>
  )
}
