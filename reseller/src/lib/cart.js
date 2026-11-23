import { useCallback, useEffect, useState } from 'react'
import { iqd } from './format'
import { inStock, maxUnits, minUnits, unitsText } from './qty'

// السلة محلية لكل متجر: cart:<slug> → [{id, units, price, name}]. price لقطة وقت الإضافة لنكشف تغيّره.
const key = (slug) => `cart:${slug}`
const read = (slug) => {
  try {
    const v = JSON.parse(localStorage.getItem(key(slug)) || '[]')
    return Array.isArray(v) ? v.filter((l) => l && typeof l.id === 'string' && l.units > 0) : []
  } catch { return [] }
}
const write = (slug, lines) => { try { localStorage.setItem(key(slug), JSON.stringify(lines)) } catch { /* وضع خاص: تبقى السلة في الذاكرة */ } }

/** يوفّق السلة مع المنتجات الحالية: يحذف المفقود/النافد، يقصّ الكمية، ويسجّل تغيّر السعر. الإخراج: {lines, notes} */
export function reconcile(lines, products) {
  const byId = new Map(products.map((p) => [p.id, p]))
  const out = [], notes = []
  for (const l of lines) {
    const p = byId.get(l.id)
    if (!p || !inStock(p)) { notes.push(`«${l.name}» ${p ? 'نفد' : 'لم يعد متوفراً'} وأُزيل من السلة`); continue }
    const units = Math.min(Math.max(l.units, minUnits(p)), maxUnits(p))
    if (units < l.units) notes.push(`«${p.name}»: المتاح الآن ${unitsText(p, units)} فقط`)
    if (l.price !== p.price) notes.push(`تغيّر سعر «${p.name}» من ${iqd(l.price)} إلى ${iqd(p.price)}`)
    out.push({ id: p.id, units, price: p.price, name: p.name })
  }
  return { lines: out, notes }
}

export function useCart(slug) {
  const [lines, set] = useState(() => read(slug))
  useEffect(() => { set(read(slug)) }, [slug])
  const commit = useCallback((next) => { write(slug, next); set(next) }, [slug])
  return {
    lines,
    commit,
    setUnits: (p, units) => commit(units <= 0 ? lines.filter((l) => l.id !== p.id)
      : lines.some((l) => l.id === p.id) ? lines.map((l) => (l.id === p.id ? { ...l, units, price: p.price } : l))
      : [...lines, { id: p.id, units, price: p.price, name: p.name }]),
    remove: (id) => commit(lines.filter((l) => l.id !== id)),
    clear: () => commit([]),
  }
}
