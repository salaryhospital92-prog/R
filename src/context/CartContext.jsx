import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const CartContext = createContext(null)
const STORAGE_KEY = 'alrifaie-cart'

export const useCart = () => useContext(CartContext)

const load = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (saved?.mode && saved?.items) return saved
  } catch { /* سلة تالفة — نبدأ من جديد */ }
  return { mode: null, items: {} }
}

export function CartProvider({ children }) {
  const [cart, setCart] = useState(load)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart))
  }, [cart])

  const value = useMemo(() => ({
    mode: cart.mode,
    items: cart.items,           // { [productId]: qty بالقطع }
    count: Object.keys(cart.items).length,
    units: Object.values(cart.items).reduce((a, b) => a + b, 0),

    // تبديل الوضع يفرغ السلة: الأسعار تختلف بين الجملة والمفرد
    setMode: (mode) =>
      setCart((c) => (c.mode === mode ? c : { mode, items: {} })),

    setQty: (productId, qty) =>
      setCart((c) => {
        const items = { ...c.items }
        if (qty > 0) items[productId] = qty
        else delete items[productId]
        return { ...c, items }
      }),

    clear: () => setCart((c) => ({ ...c, items: {} })),
  }), [cart])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
