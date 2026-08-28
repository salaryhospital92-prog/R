/**
 * بحث جوجل عن صور المنتج — بالباركود إن وُجد (أدق)، وإلا بالاسم.
 * الباركود يُبحث كنص مجرّد لأن أرقام EAN تُعطي نتائج المنتج نفسه غالباً.
 */
export const googleImages = (term) =>
  `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(String(term).trim())}`

/** بحث عام (صفحات) — مفيد لمعرفة اسم المنتج من باركوده */
export const googleSearch = (term) =>
  `https://www.google.com/search?q=${encodeURIComponent(String(term).trim())}`

/**
 * عدسة جوجل (Lens) بحث بالصورة — تحتاج رابطاً عاماً للصورة،
 * لذلك تعمل بعد رفع الصورة إلى التخزين.
 */
export const googleLens = (imageUrl) =>
  `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`

/** بحث جوجل العكسي بالصورة — بديل لعدسة جوجل على الحاسوب */
export const reverseImageSearch = (imageUrl) =>
  `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(imageUrl)}`
