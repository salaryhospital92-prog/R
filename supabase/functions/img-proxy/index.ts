// =====================================================================
// وسيط جلب الصور — يجلب صورة من رابط خارجي ويعيدها للمتصفح.
//
// لماذا؟ المتصفح يمنع قراءة صور المواقع الأخرى (CORS)، فلا يستطيع تصغيرها
// ورفعها. هذا الوسيط يجلبها من الخادم ويعيدها بترويسات تسمح للمتصفح
// بمعالجتها — فتمرّ بنفس مسار التصغير المعتاد (1024px) ولا تنتفخ المساحة.
//
// لا يكتب شيئاً في التخزين — يقرأ ويعيد فقط. والوصول للموظفين المسجّلين.
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAX_BYTES = 12 * 1024 * 1024   // سقف الحماية قبل التصغير في المتصفح

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

/** يمنع توجيه الوسيط نحو الشبكة الداخلية (SSRF) */
function isPrivateHost(host: string) {
  const h = host.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
}

const fail = (status: number, msg: string) =>
  new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // موظف مسجّل فقط — الوسيط ليس مفتوحاً للعموم
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!jwt) return fail(401, 'يلزم تسجيل الدخول')

  const { data: userRes } = await admin.auth.getUser(jwt)
  const userId = userRes?.user?.id
  if (!userId) return fail(401, 'الجلسة غير صالحة')

  const { data: profile } = await admin
    .from('profiles').select('is_active').eq('id', userId).maybeSingle()
  if (!profile?.is_active) return fail(403, 'غير مصرّح')

  let target: URL
  try {
    target = new URL(new URL(req.url).searchParams.get('url') ?? '')
  } catch {
    return fail(400, 'رابط غير صالح')
  }
  if (!['http:', 'https:'].includes(target.protocol)) return fail(400, 'رابط غير مدعوم')
  if (isPrivateHost(target.hostname)) return fail(400, 'رابط غير مسموح')

  let upstream: Response
  try {
    upstream = await fetch(target.toString(), {
      redirect: 'follow',
      headers: {
        // بعض المواقع ترفض الطلبات بلا متصفح معروف
        'User-Agent': 'Mozilla/5.0 (compatible; AlRifaiShop/1.0)',
        Accept: 'image/*,*/*;q=0.8',
      },
    })
  } catch {
    return fail(502, 'تعذّر الوصول إلى الرابط')
  }

  if (!upstream.ok) return fail(502, `الموقع ردّ بالرمز ${upstream.status}`)

  const type = upstream.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) return fail(415, 'الرابط ليس صورة')

  const size = Number(upstream.headers.get('content-length') ?? 0)
  if (size > MAX_BYTES) return fail(413, 'الصورة كبيرة جداً')

  const bytes = new Uint8Array(await upstream.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) return fail(413, 'الصورة كبيرة جداً')

  return new Response(bytes, {
    headers: { ...CORS, 'Content-Type': type, 'Cache-Control': 'no-store' },
  })
})
