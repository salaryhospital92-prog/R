import { supabase } from './supabase'

/**
 * تصغير الصورة في المتصفح قبل الرفع — إنترنت المتجر قد يكون بطيئاً،
 * وصورة الجوال الأصلية قد تتجاوز 5 ميغابايت بلا فائدة.
 * imageOrientation تحفظ اتجاه الصورة الملتقطة بالجوال (EXIF).
 */
export async function resizeImage(file, maxWidth = 1024, quality = 0.8) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxWidth / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality))
  if (!blob) throw new Error('تعذّر معالجة الصورة')
  return blob
}

export const imagePath = (productId) => `${productId}.jpg`

/**
 * يرفع الصورة إلى bucket product-images ويعيد الرابط العام.
 * المسار ثابت لكل منتج (المعرّف نفسه) والرفع upsert — فتبديل الصورة يستبدل
 * الملف بدل أن يترك نسخة يتيمة تأكل المساحة. ولاحقة ?v= تكسر ذاكرة المتصفح.
 */
export async function uploadProductImage(file, productId) {
  const blob = await resizeImage(file)

  const { error } = await supabase.storage
    .from('product-images')
    .upload(imagePath(productId), blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: true,
    })
  if (error) throw new Error('فشل رفع الصورة: ' + error.message)

  const { publicUrl } = supabase.storage.from('product-images').getPublicUrl(imagePath(productId)).data
  return `${publicUrl}?v=${Date.now()}`
}

/** يحذف صورة منتج — يُستدعى عند حذف المنتج حتى لا تبقى ملفات يتيمة */
export const deleteProductImage = (productId) =>
  supabase.storage.from('product-images').remove([imagePath(productId)])

/**
 * يجلب صورة من رابط خارجي عبر وسيط الخادم (لتجاوز حجب CORS)،
 * ثم تمرّ بنفس مسار التصغير والرفع — فلا تختلف عن صورة الكاميرا.
 */
export async function fetchImageFromUrl(url) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('انتهت الجلسة — سجّل الدخول من جديد')

  const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/img-proxy?url=${encodeURIComponent(url)}`
  const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${session.access_token}` } })

  if (!res.ok) {
    const { error } = await res.json().catch(() => ({}))
    throw new Error(error ?? 'تعذّر جلب الصورة من الرابط')
  }

  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error('الرابط ليس صورة')
  return new File([blob], 'from-url.jpg', { type: blob.type })
}
