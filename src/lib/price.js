import { stepFor } from '../context/CartContext'

/** السعر كما أُدخل: المفرد للقطعة، والجملة ثمن الدرزن (أو القطعة لما يُباع بالقطعة) — بلا قسمة */
export const priceOf = (p, mode) =>
  mode !== 'wholesale' ? p.price_retail : p.sold_by === 'piece' ? p.price_wholesale : p.price_dozen

/** مجموع السطر: الكمية بالقطع، والسعر لكل خطوة (درزن أو قطعة) */
export const lineTotal = (p, mode, qty) => priceOf(p, mode) * (qty / stepFor(mode, p.sold_by))
