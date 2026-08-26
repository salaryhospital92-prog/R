/**
 * نسخة الأصول. ارفع الرقم كلما بدّلت الشعار أو الأيقونات — يجبر المتصفحات
 * وواتساب وتيليغرام على جلب النسخة الجديدة بدل المخزَّنة عندها.
 */
export const ASSET_V = '2'

/** عنوان أصل ثابت داخل الموقع، بنسخته */
export const asset = (name) => `${import.meta.env.BASE_URL}${name}?v=${ASSET_V}`

/** بيانات المحل — تُعرض في المتجر وتُستعمل في روابط الاتصال */
export const STORE = {
  name: 'أسواق الرفاعي',
  address: 'العراق — الأنبار — الرمادي — شارع السينما — فرع الشورجة',
  addressShort: 'الرمادي — شارع السينما',
  phone: import.meta.env.VITE_STORE_PHONE || '07829137822',
  hours: 'يومياً من 9:00 صباحاً حتى 10:00 مساءً',
}

/** رقم استقبال الطلبات (يبني رسالة الطلب) */
export const ORDER_WHATSAPP = import.meta.env.VITE_STORE_WHATSAPP

/** رقم التواصل المباشر — يفتح محادثة واتساب برسالة ترحيب جاهزة */
export const CONTACT_WHATSAPP = import.meta.env.VITE_CONTACT_WHATSAPP

export const telUrl = () => `tel:${STORE.phone}`

export const contactWhatsappUrl = (text = 'السلام عليكم، عندي استفسار عن منتجات أسواق الرفاعي') =>
  `https://wa.me/${CONTACT_WHATSAPP}?text=${encodeURIComponent(text)}`
