/**
 * بحث جوجل عن صور المنتج — بالباركود إن وُجد (أدق)، وإلا بالاسم.
 * الباركود يُبحث كنص مجرّد لأن أرقام EAN تُعطي نتائج المنتج نفسه غالباً.
 */
export const googleImages = (term) =>
  `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(String(term).trim())}`

/** بحث عام (صفحات) — مفيد لمعرفة اسم المنتج من باركوده */
export const googleSearch = (term) =>
  `https://www.google.com/search?q=${encodeURIComponent(String(term).trim())}`
