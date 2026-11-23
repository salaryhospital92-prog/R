import { useSyncExternalStore } from 'react'

// هوية المتجر من النطاق الفرعي (متجر.النطاق أو متجر.localhost)، وبديل التطوير /s/:slug.
const ROOT = (import.meta.env.VITE_ROOT_DOMAIN || '').toLowerCase()
const SLUG_RE = /^[a-z0-9](-?[a-z0-9]){2,29}$/

function locate() {
  const path = location.pathname
  const m = path.match(/^\/s\/([^/]+)(\/.*)?$/)
  if (m) return { slug: m[1].toLowerCase(), base: `/s/${m[1]}`, path: m[2] || '/' }
  const host = location.hostname.toLowerCase()
  const sub = host.endsWith('.localhost') ? host.slice(0, -10) : ROOT && host.endsWith('.' + ROOT) ? host.slice(0, -ROOT.length - 1) : null
  return { slug: sub, base: '', path }
}
export const slugOk = (s) => typeof s === 'string' && SLUG_RE.test(s)

let snap = location.pathname
const subs = new Set()
const sub = (f) => (subs.add(f), () => subs.delete(f))
const tick = () => { snap = location.pathname + location.search; subs.forEach((f) => f()) }
addEventListener('popstate', tick)

/** يعيد {slug, path} ويتجدد عند أي تنقّل */
export function useLocation() {
  useSyncExternalStore(sub, () => snap)
  return locate()
}
/** رابط داخل المتجر الحالي */
export const href = (to) => locate().base + (to === '/' ? (locate().base ? '' : '/') : to)
export function go(to, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', href(to))
  tick()
  scrollTo(0, 0)
}
export const back = (fallback = '/') => (history.length > 1 ? history.back() : go(fallback, { replace: true }))
