import { formatIQD, formatNumber } from './format'

/** أصل الموقع — منه تُبنى روابط صفحات المنتجات داخل النص */
const STORE_URL = typeof window === 'undefined' ? 'https://alrifai.shop' : window.location.origin

/**
 * نصّ الطلب — يُبنى من ردّ create_order فقط، لا من السلة المحلية، فيطابق
 * دائماً ما هو محفوظ في قاعدة البيانات برقم الطلب.
 *
 * الطلب يصل المتجر بنفسه (مشغّل قاعدة البيانات ← بوت تيليغرام)، وهذا النصّ
 * نسخة للزبون يحتفظ بها أو يرسلها لمن يشاء — ليس قناة إرسال.
 */
export function buildOrderMessage(order) {
  const lines = [
    `*طلب #${order.order_number}*`,
    'أسواق الرفاعي — الرمادي، شارع السينما',
    '',
    `الزبون: ${order.customer_name}`,
    `الهاتف: ${order.customer_phone}`,
    `نوع البيع: ${order.mode === 'wholesale' ? 'جملة' : 'مفرد'}`,
    '',
    '*المنتجات:*',
  ]

  order.items.forEach((it, i) => {
    const qty = order.mode === 'wholesale' && it.qty % 12 === 0
      ? `${formatNumber(it.qty / 12)} درزن (${formatNumber(it.qty)} قطعة)`
      : `${formatNumber(it.qty)} قطعة`
    lines.push(
      it.price_on_request
        ? `${i + 1}. ${it.name} — ${qty} — السعر عند الطلب`
        : `${i + 1}. ${it.name} — ${qty} × ${formatIQD(it.dozen_price ?? it.unit_price)}${it.dozen_price != null ? ' للدرزن' : ''} = ${formatIQD(it.line_total)}`,
    )
    // سطر التمييز: أسماء كثيرة متطابقة، والرمز والباركود يفصلان بينها.
    // الطلبات القديمة لا تحمل الرمز — يُتخطّى السطر عندها بلا كسر.
    if (it.code) {
      lines.push(`   ${STORE_URL}/p/${it.code}${it.barcode ? ` · باركود ${it.barcode}` : ''}`)
    }
  })

  lines.push(
    '',
    `مجموع البضاعة: ${formatIQD(order.subtotal)}`,
    `التوصيل (${order.delivery_zone}): ${formatIQD(order.delivery_fee)}`,
    `*المجموع الكلي: ${formatIQD(order.total_amount)}*`,
  )

  if (order.customer_note) lines.push('', `ملاحظة: ${order.customer_note}`)
  if (order.has_price_request) lines.push('', '⚠️ الطلب يحتوي بنداً بلا سعر — يُحدَّد عند التأكيد.')

  return lines.join('\n')
}
