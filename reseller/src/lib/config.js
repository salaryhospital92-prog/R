// عناوين مشتركة بين المتجر واللوحة. المتصفح لا يعرف مشروع القاعدة: كل شيء عبر /api على نطاق الصفحة (وكيل).
export const API = import.meta.env.VITE_API_URL || `${location.origin}/api`
export const ANON = import.meta.env.VITE_ANON_KEY || 'anon'
export const ROOT = (import.meta.env.VITE_ROOT_DOMAIN || '').toLowerCase()

/** شعار المتجر: حاوية عامة، والمسار تتحقق منه الدالة (مجلد/اسم آمن) */
export const logoUrl = (path) => path && `${API}/storage/v1/object/public/reseller-logos/${path.split('/').map(encodeURIComponent).join('/')}`
/** صورة منتج خاص (حاوية عامة) */
export const ownImageUrl = (path) => path && `${API}/storage/v1/object/public/reseller-products/${path.split('/').map(encodeURIComponent).join('/')}`
export const errText = (e) => (e?.code === 'P0001' && /[؀-ۿ]/.test(e.message || '') ? e.message : 'تعذّر الاتصال — تحقق من الإنترنت وحاول مرة أخرى')
