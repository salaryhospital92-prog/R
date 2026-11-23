import { formatNumber } from './format'

/**
 * السعر كما أُدخل، بلا قسمة. نفس قواعد create_order (ترحيل 014) — غيّرهما معاً.
 *   العلبة  pack_qty قطعة بثمن price_dozen: في الجملة، أو دائماً لما لا مفرد له (pack_only)
 *   القطعة  مفرد price_retail، ومن wholesale_min فما فوق price_wholesale
 */
export const packOf = (p, mode) =>
  p.pack_only || (mode === 'wholesale' && p.sold_by !== 'piece') ? (p.pack_qty ?? 12) : 0

export const stepFor = (mode, p) => packOf(p, mode) || 1

export const minFor = (mode, p) =>
  packOf(p, mode) || (mode === 'wholesale' ? p.wholesale_min ?? 1 : 1)

/** أكبر كمية تُطلب، و0 إن لم يكفِ المخزون لأقل كمية */
export const maxFor = (mode, p) => {
  const step = stepFor(mode, p)
  const max = Math.floor(p.quantity_single / step) * step
  return max < minFor(mode, p) ? 0 : max
}

/** له سعر أخصّ عند بلوغ كمية (في وضع المفرد) */
export const hasTier = (p) => p.sold_by === 'piece' && p.wholesale_min > 1 && p.price_wholesale > 0

export const priceOf = (p, mode, qty = 0) => {
  if (packOf(p, mode)) return p.price_dozen
  return mode === 'wholesale' || (hasTier(p) && qty >= p.wholesale_min) ? p.price_wholesale : p.price_retail
}

export const lineTotal = (p, mode, qty) => priceOf(p, mode, qty) * (qty / stepFor(mode, p))

export const packName = (pack) => (pack === 12 ? 'درزن' : 'علبة')

/** «سعر الدرزن (12 قطعة)» أو «سعر العلبة (24 قطعة)» أو شرط كمية الجملة */
export const priceNote = (p, mode) => {
  const pack = packOf(p, mode)
  if (pack) return `سعر ال${packName(pack)} (${formatNumber(pack)} قطعة)`
  if (mode === 'wholesale') return p.wholesale_min > 1 ? `للقطعة — من ${piecesText(p.wholesale_min)} فما فوق` : 'يُباع بالقطعة'
  return ''
}

export const qtyText = (qty, pack) =>
  pack ? `${formatNumber(qty / pack)} ${packName(pack)}` : `${formatNumber(qty)} قطعة`

/** كمية بند محفوظ؛ الطلبات القديمة بلا pack_qty تُعرض بقاعدتها السابقة */
export const itemQtyText = (it, mode) =>
  qtyText(it.qty, it.pack_qty !== undefined ? it.pack_qty : mode === 'wholesale' && it.qty % 12 === 0 ? 12 : 0)

/** «قطعتين» أو «4 قطع» */
export const piecesText = (n) => (n === 2 ? 'قطعتين' : `${formatNumber(n)} قطع`)
