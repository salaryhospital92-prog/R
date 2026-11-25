// دخول المروّجين عبر تيليغرام — المنطق كله هنا بلا اعتماد على Deno أو Node، ليُجرَّب محلياً كما هو.
//   POST /start    {secret}          ← الصفحة تطلب رمزاً (تحتفظ بالسر ولا يخرج من المتصفح إلا للخادم)
//   POST /poll     {nonce, secret}   ← الصفحة تسأل: هل ضغط المروّج الرقم الصحيح؟ فتستلم جلسة
//   POST /webhook  (تيليغرام)        ← /start login_<رمز> ← ثلاثة أرقام ← جهة الاتصال أول مرة
//   POST /register (ترويسة X-Setup-Secret = سرّ الويبهوك) ← تسجيل الويبهوك من خوادم Supabase (تيليغرام غير متاح من بعض الشبكات)
// الاعتماديات تُحقن: db (عميل بمفتاح الخدمة)، tg(method, payload)، session(email)، env.
// كل القرارات الأمنية (الأرقام، الانتهاء، مرة واحدة، جهة اتصال صاحبها) في دوال 021 لا هنا.

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })
const sha256 = async (s) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')

const T = {
  hello: 'أهلاً 👋\nللدخول إلى منصة المتاجر: افتح الموقع واضغط «الدخول عبر تيليغرام».',
  pick: 'تسجيل الدخول إلى منصة المتاجر 🔐\nاضغط الرقم الظاهر على شاشة المتصفح.\nإن لم تكن أنت من طلب الدخول فتجاهل هذه الرسالة.',
  done: 'تم ✅ ارجع الآن إلى المتصفح.',
  phone: 'خطوة أخيرة: شارك رقم هاتفك بالزر أدناه ليتأكد المتجر منك (مرة واحدة فقط).',
  shareBtn: '📱 مشاركة رقمي',
  wrong: 'الرقم غير صحيح، أُلغيت المحاولة. أعد الدخول من الموقع.',
  expired: 'انتهت صلاحية المحاولة. أعد الدخول من الموقع.',
  notYours: 'شارك رقمك أنت بالزر أسفل الشاشة، لا جهة اتصال أخرى.',
  badPhone: 'المنصة لأرقام العراق فقط.',
}

export function makeHandler({ db, tg, session, env }) {
  const rpc = async (fn, args) => {
    const { data, error } = await db.rpc(fn, args)
    if (error) throw error
    return data
  }
  const fail = (e) => json({ error: /[؀-ۿ]/.test(e?.message ?? '') ? e.message : 'تعذّر إتمام الطلب' }, e?.code === 'P0001' ? 429 : 500)

  async function start(body) {
    if (typeof body?.secret !== 'string' || !/^[0-9a-f]{32,128}$/.test(body.secret)) return json({ error: 'طلب غير صالح' }, 400)
    const r = await rpc('reseller_login_new', { p_hash: await sha256(body.secret) })
    return json({ ...r, bot: `https://t.me/${env.BOT_USERNAME}?start=login_${r.nonce}` })
  }

  async function poll(body) {
    if (typeof body?.nonce !== 'string' || typeof body?.secret !== 'string') return json({ status: 'expired' })
    const r = await rpc('reseller_login_poll', { p_nonce: body.nonce, p_hash: await sha256(body.secret) })
    if (r.status !== 'ok') return json({ status: r.status })
    // مستخدم auth: يُنشأ أول مرة (بريد تركيبي مؤكَّد لا يُراسَل)، وتثبَّت الهوية
    const s = await session(`tg${r.telegram_id}@telegram.invalid`)
    await rpc('reseller_identity_save', { p_telegram_id: r.telegram_id, p_user_id: s.userId, p_name: r.name, p_phone: r.phone })
    return json({ status: 'ok', ...s.payload })
  }

  async function webhook(req, update) {
    if (env.WEBHOOK_SECRET && req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return
    const msg = update.message, cbq = update.callback_query
    const from = msg?.from ?? cbq?.from
    const chat = msg?.chat ?? cbq?.message?.chat
    if (!from || chat?.type !== 'private') return
    const say = (text, extra = {}) => tg('sendMessage', { chat_id: from.id, text, ...extra })
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ')

    if (cbq) {
      await tg('answerCallbackQuery', { callback_query_id: cbq.id })
      const m = /^lp:([0-9a-f]{16}):(\d{2})$/.exec(cbq.data ?? '')
      if (!m) return
      const r = await rpc('reseller_login_pick', { p_nonce: m[1], p_telegram_id: from.id, p_pick: +m[2] })
      if (r === 'confirmed') await say(T.done)
      else if (r === 'need_phone') await say(T.phone, { reply_markup: { keyboard: [[{ text: T.shareBtn, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } })
      else await say(r === 'wrong' ? T.wrong : T.expired)
      return
    }
    if (msg.contact) {
      const r = await rpc('reseller_login_phone', { p_telegram_id: from.id, p_contact_user_id: msg.contact.user_id ?? null, p_phone: msg.contact.phone_number })
      await say(r === 'ok' ? T.done : r === 'not_yours' ? T.notYours : r === 'bad_phone' ? T.badPhone : T.expired, r === 'ok' ? { reply_markup: { remove_keyboard: true } } : {})
      return
    }
    const m = /^\/start login_([0-9a-f]{16})$/.exec((msg.text ?? '').trim())
    if (!m) return void (await say(T.hello))
    const opts = await rpc('reseller_login_claim', { p_nonce: m[1], p_telegram_id: from.id, p_name: name })
    if (!opts) return void (await say(T.expired))
    await say(T.pick, { reply_markup: { inline_keyboard: [opts.map((n) => ({ text: String(n), callback_data: `lp:${m[1]}:${n}` }))] } })
  }

  // يسجّل الويبهوك ويتحقق من الرمز (getMe). لا يعمل بلا سرّ الويبهوك الصحيح في الترويسة.
  async function register(req) {
    if (!env.WEBHOOK_SECRET || req.headers.get('X-Setup-Secret') !== env.WEBHOOK_SECRET) return json({ error: 'forbidden' }, 403)
    const me = await tg('getMe', {})
    if (!me?.ok) return json({ error: 'الرمز غير صالح عند تيليغرام' }, 502)
    const hook = await tg('setWebhook', { url: env.WEBHOOK_URL, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true })
    return json({ ok: !!hook?.ok, bot: me.result?.username, expected: env.BOT_USERNAME, webhook: env.WEBHOOK_URL, telegram: hook?.description })
  }

  return async (req) => {
    const path = new URL(req.url).pathname.replace(/\/+$/, '')
    if (req.method !== 'POST') return json({ error: 'method' }, 405)
    let body
    try { body = await req.json() } catch { return json({ error: 'طلب غير صالح' }, 400) }
    try {
      if (path.endsWith('/start')) return await start(body)
      if (path.endsWith('/poll')) return await poll(body)
      if (path.endsWith('/webhook')) { await webhook(req, body); return json({ ok: true }) }
      if (path.endsWith('/register')) return await register(req)
      return json({ error: 'not found' }, 404)
    } catch (e) {
      // تيليغرام يعيد المحاولة على أي غير 200: الخطأ يُسجَّل ويُردّ 200
      console.error('reseller-login', e?.message ?? e)
      return path.endsWith('/webhook') ? json({ ok: true }) : fail(e)
    }
  }
}
