// أرقام لاتينية (1234567890) بطلب المالك — أوضح للقراءة السريعة في المتجر،
// مع فاصلة الآلاف. اللغة عربية والأرقام لاتينية.
const iqd = new Intl.NumberFormat('ar-IQ-u-nu-latn', { maximumFractionDigits: 0 })

/** تنسيق مبلغ بالدينار العراقي — المبالغ أعداد صحيحة بلا كسور. مثال: ‎١٠٬٠٠٠ د.ع */
export const formatIQD = (amount) => `${iqd.format(Math.round(Number(amount) || 0))} د.ع`

/** تنسيق عدد عربي بلا عملة (الكميات مثلاً) */
export const formatNumber = (n) => iqd.format(Number(n) || 0)

/** منطق الدرزن: الإجمالي بالقطع المفردة */
export const totalUnits = (dozens, singles) =>
  (Number(dozens) || 0) * 12 + (Number(singles) || 0)
