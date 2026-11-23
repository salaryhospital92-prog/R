// أرقام لاتينية مع فاصلة الآلاف. المبالغ أعداد صحيحة بالدينار، كما أدخلها مدخل البيانات.
const nf = new Intl.NumberFormat('ar-IQ-u-nu-latn', { maximumFractionDigits: 0 })
export const num = (n) => nf.format(Number(n) || 0)
export const iqd = (n) => `${num(n)} د.ع`

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
/** أرقام عربية/فارسية ← لاتينية */
export const latin = (s) => String(s ?? '').replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.includes(d) ? AR_DIGITS.indexOf(d) : FA_DIGITS.indexOf(d)))
/** هاتف موبايل عراقي: 07xxxxxxxxx أو +9647xxxxxxxxx أو 7xxxxxxxxx ← 07xxxxxxxxx، وإلا null */
export const phoneOf = (s) => {
  const d = latin(s).replace(/[\s\-().]/g, '').replace(/^\+/, '')
  const m = d.match(/^(?:00)?(?:964)?0?(7\d{9})$/)
  return m ? '0' + m[1] : null
}
/** تطبيع للبحث: يوحّد الألف والياء والتاء المربوطة ويحذف التشكيل */
export const norm = (s) => latin(s).toLowerCase().replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
