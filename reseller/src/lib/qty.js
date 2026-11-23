import { num } from './format'

// وحدة البيع: قطعة، أو علبة (درزن 12 / علبة 24 أو 25...) لما يُباع علباً — كما في قواعد الدالة.
// الأسعار والكميات تأتي محسوبة من reseller_store_products؛ هنا العرض فقط.
//   price   سعر الوحدة المباعة   pack_qty عدد قطع العلبة (null = قطعة)
//   min_qty أقل كمية بالقطع       max_qty أكبر كمية بالقطع (0 = نفد)
// السلة تحفظ «وحدات»؛ ما يُرسل للخادم قطع = وحدات × الخطوة، وثمن البند = السعر × الوحدات.
export const packName = (pack) => (pack === 12 ? 'درزن' : 'علبة')
export const piecesText = (n) => (n === 2 ? 'قطعتين' : `${num(n)} قطع`)
export const stepOf = (p) => p.pack_qty || 1
export const minUnits = (p) => Math.ceil(p.min_qty / stepOf(p))
export const maxUnits = (p) => Math.floor(p.max_qty / stepOf(p))
export const inStock = (p) => p.max_qty > 0 && maxUnits(p) >= minUnits(p)
export const pieces = (p, units) => units * stepOf(p)
export const lineTotal = (p, units) => p.price * units

/** «سعر الدرزن (12 قطعة)» أو «للقطعة» */
export const priceNote = (p) => (p.pack_qty ? `سعر ال${packName(p.pack_qty)} (${num(p.pack_qty)} قطعة)` : 'للقطعة')
/** «أقل كمية: 3 قطع» لما حدّه الأدنى فوق الواحد */
export const minNote = (p) => (!p.pack_qty && p.min_qty > 1 ? `أقل كمية: ${piecesText(p.min_qty)}` : '')
/** كمية في السلة: «2 درزن» أو «3 قطعة» */
export const unitsText = (p, units) => (p.pack_qty ? `${num(units)} ${packName(p.pack_qty)}` : `${num(units)} قطعة`)
