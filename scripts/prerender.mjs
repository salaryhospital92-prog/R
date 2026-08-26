/**
 * يولّد صفحة HTML ثابتة لكل منتج تحت dist/p/<code>/index.html
 * بوسوم Open Graph خاصة به — فتظهر صورة المنتج وسعره عند مشاركة رابطه
 * في واتساب وتيليغرام (هذه التطبيقات لا تشغّل JavaScript).
 *
 * المنتجات الجديدة تعمل صفحاتها فوراً عبر 404.html، وتحصل على بطاقة
 * المشاركة الخاصة بها عند أول بناء تالٍ.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const SITE = 'https://alrifai.shop'
const DIST = 'dist'

// Vite يقرأ ملفات .env بنفسه، أما هذا السكربت فيعمل في Node مباشرةً
for (const f of ['.env.production', '.env']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.log('تخطّي التوليد: مفاتيح Supabase غير متاحة')
  process.exit(0)
}

const iqd = (n) => `${new Intl.NumberFormat('en-US').format(Math.round(Number(n) || 0))} د.ع`
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const db = createClient(url, key, { auth: { persistSession: false } })
const { data: products, error } = await db
  .from('storefront_products')
  .select('code, name, category, image_url, price_retail, price_wholesale, in_stock')

if (error) {
  console.log('تعذّر جلب المنتجات:', error.message, '— تخطّي التوليد')
  process.exit(0)
}

const template = readFileSync(join(DIST, 'index.html'), 'utf8')

/** يستبدل قيمة وسم موجود، أو يتركه كما هو إن لم يوجد */
const setMeta = (html, attr, name, value) =>
  html.replace(
    new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`),
    `$1${esc(value)}$2`,
  )

let count = 0
for (const p of products ?? []) {
  const priceText = p.price_retail > 0 ? iqd(p.price_retail) : 'السعر عند الطلب'
  const title = `${p.name} — أسواق الرفاعي`
  const desc = [
    p.category,
    priceText,
    p.price_wholesale > 0 ? `الجملة ${iqd(p.price_wholesale)} للقطعة` : null,
    p.in_stock ? 'متوفر الآن' : 'غير متوفر حالياً',
    'توصيل لكل المحافظات — اطلب عبر واتساب.',
  ].filter(Boolean).join(' · ')
  const image = p.image_url || `${SITE}/og.jpg?v=2`
  const pageUrl = `${SITE}/p/${p.code}`

  let html = template
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
  html = setMeta(html, 'name', 'description', desc)
  html = setMeta(html, 'property', 'og:url', pageUrl)
  html = setMeta(html, 'property', 'og:title', title)
  html = setMeta(html, 'property', 'og:description', desc)
  html = setMeta(html, 'property', 'og:image', image)
  html = setMeta(html, 'property', 'og:image:alt', p.name)
  html = setMeta(html, 'name', 'twitter:title', title)
  html = setMeta(html, 'name', 'twitter:description', desc)
  html = setMeta(html, 'name', 'twitter:image', image)
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${pageUrl}$2`)
  // مقاس الصورة يخصّ og.jpg وحدها — صور المنتجات مربّعة
  if (p.image_url) {
    html = html.replace(/<meta property="og:image:width" content="\d+" \/>/, '<meta property="og:image:width" content="1024" />')
    html = html.replace(/<meta property="og:image:height" content="\d+" \/>/, '<meta property="og:image:height" content="1024" />')
    html = html.replace(/<meta property="og:image:type" content="[^"]*" \/>/, '<meta property="og:image:type" content="image/jpeg" />')
  }

  const dir = join(DIST, 'p', p.code)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), html)
  count++
}

// صفحات المسارات الرئيسية — بدونها يعيد GitHub Pages رمز 404 وإن عُرض التطبيق
const ROUTES = [
  { path: 'retail',    title: 'شراء مفرد — أسواق الرفاعي',
    desc: 'تسوّق بالقطعة: عطور، منتجات بشرة، كوزمتك، مواد منزلية ومعطرات. توصيل لكل المحافظات.' },
  { path: 'wholesale', title: 'شراء جملة — أسواق الرفاعي',
    desc: 'أسعار الجملة بالدرزن لكل الأصناف. توصيل لكل المحافظات — اطلب عبر واتساب.' },
  { path: 'checkout',  title: 'سلّة المشتريات — أسواق الرفاعي', desc: null },
  { path: 'dashboard', title: 'لوحة الإدارة — أسواق الرفاعي', desc: null },
]

for (const r of ROUTES) {
  let html = template.replace(/<title>[^<]*<\/title>/, `<title>${esc(r.title)}</title>`)
  html = setMeta(html, 'property', 'og:title', r.title)
  html = setMeta(html, 'name', 'twitter:title', r.title)
  html = setMeta(html, 'property', 'og:url', `${SITE}/${r.path}`)
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${SITE}/${r.path}$2`)
  if (r.desc) {
    html = setMeta(html, 'name', 'description', r.desc)
    html = setMeta(html, 'property', 'og:description', r.desc)
    html = setMeta(html, 'name', 'twitter:description', r.desc)
  }
  mkdirSync(join(DIST, r.path), { recursive: true })
  writeFileSync(join(DIST, r.path, 'index.html'), html)
}

// خريطة الموقع لمحركات البحث
const urls = [SITE + '/', SITE + '/retail', SITE + '/wholesale',
  ...(products ?? []).map((p) => `${SITE}/p/${p.code}`)]
writeFileSync(join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n') + `\n</urlset>\n`)

writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`)

console.log(`وُلّدت ${count} صفحة منتج + خريطة الموقع`)
