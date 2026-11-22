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
  hours: 'من السبت إلى الخميس، 9:00 صباحاً حتى 6:00 مساءً — الجمعة إجازة',
}

/**
 * أوقات استقبال الطلبات بتوقيت بغداد (لا بتوقيت جهاز الزبون): 9:00 ← 17:45.
 * ما بعدها يُقبل ويصل للموظف لكن يُجهَّز عند الافتتاح — `when` متى: اليوم (قبل 9:00) أو غداً.
 * نفس الحدود في notify_new_order (migration 005) — غيّرهما معاً.
 */
export function orderWindow(now = new Date()) {
  const tz = { timeZone: 'Asia/Baghdad' }
  const [h, m] = new Intl.DateTimeFormat('en-GB', { ...tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(now).split(':').map(Number)
  const day = new Intl.DateTimeFormat('en-US', { ...tz, weekday: 'short' }).format(now)
  const min = h * 60 + m
  // الجمعة إجازة طوال اليوم: كل طلب يؤجَّل إلى السبت
  if (day === 'Fri') return { open: false, holiday: true, when: 'يوم السبت' }
  if (min < 9 * 60) return { open: false, when: 'اليوم' }
  // بعد إغلاق الخميس غدُه الجمعة، فيُجهَّز السبت
  if (min > 17 * 60 + 45) return { open: false, when: day === 'Thu' ? 'يوم السبت' : 'غداً' }
  return { open: true }
}

/** رقم التواصل المباشر — يفتح محادثة واتساب برسالة ترحيب جاهزة */
export const CONTACT_WHATSAPP = import.meta.env.VITE_CONTACT_WHATSAPP

export const telUrl = () => `tel:${STORE.phone}`

export const contactWhatsappUrl = (text = 'السلام عليكم، عندي استفسار عن منتجات أسواق الرفاعي') =>
  `https://wa.me/${CONTACT_WHATSAPP}?text=${encodeURIComponent(text)}`
