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

/** يرفع الصورة إلى bucket product-images ويعيد الرابط العام */
export async function uploadProductImage(file, productId) {
  const blob = await resizeImage(file)
  const path = `${productId}-${Date.now()}.jpg`

  const { error } = await supabase.storage
    .from('product-images')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error('فشل رفع الصورة: ' + error.message)

  return supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl
}
