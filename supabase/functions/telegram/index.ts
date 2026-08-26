// =====================================================================
// أسواق الرفاعي — بوت تيليغرام: لوحة تحكم كاملة بشاشة واحدة نظيفة
//
// الأمان طبقتان:
//   1) ترويسة X-Telegram-Bot-Api-Secret-Token تطابق السر المخزَّن.
//   2) telegram_id مسجَّل ومفعَّل في telegram_agents — أو رمز دعوة صالح.
// أي فشل يُرَدّ عليه بـ 200 صامتة حتى لا نكشف شيئاً للمهاجم.
//
// «شاشة واحدة»: كل انتقال لقسم جديد يمسح رسائل القسم السابق (رسائل البوت
// ورسائل المستخدم معاً) فلا يتراكم سجل طويل.
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decodeBarcode } from './barcode.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const STORE_URL = Deno.env.get('STORE_URL') ?? ''
const API = `https://api.telegram.org/bot${BOT_TOKEN}`

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

// ---------------------------------------------------------------- أدوات
const iqd = (n: number | string) =>
  `${new Intl.NumberFormat('en-US').format(Math.round(Number(n) || 0))} د.ع`

/** يقبل الأرقام العربية والفارسية واللاتينية */
const digits = (s: string) => String(s ?? '')
  .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))

const num = (s: string) => {
  const c = digits(s).replace(/[^\d]/g, '')
  return c === '' ? NaN : Number(c)
}

const today = () => new Date().toISOString().slice(0, 10)
const shift = (d: number) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10)
const monthStart = () => today().slice(0, 8) + '01'
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim())

async function tg(method: string, payload: unknown) {
  try {
    const r = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return await r.json()
  } catch {
    return {}
  }
}

type Row = Array<[string, string]>
// الزر إما إجراء (callback_data) أو رابط خارجي إن بدأ بـ http
const kb = (...r: Row[]) =>
  r.filter((row) => row.length).map((row) =>
    row.map(([text, data]) =>
      data.startsWith('http') ? { text, url: data } : { text, callback_data: data }))

const backRow = (): Row => [['⬅️ القائمة الرئيسية', 'm:main']]
const cancelRow = (): Row => [['✖️ إلغاء', 'm:main']]

// ------------------------------------------------- حالة المحادثة والشاشة
type State = { flow?: string; step?: string; data?: Record<string, any>; msgs?: number[] }

async function getState(chat: number): Promise<State> {
  const { data } = await db.from('telegram_sessions').select('state').eq('chat_id', chat).maybeSingle()
  return (data?.state as State) ?? {}
}
const putState = (chat: number, state: State) =>
  db.from('telegram_sessions').upsert({ chat_id: chat, state, updated_at: new Date().toISOString() })

/** يتذكّر رسالة لتُمسح لاحقاً عند الانتقال لشاشة أخرى */
async function track(chat: number, id?: number) {
  if (!id) return
  const st = await getState(chat)
  await putState(chat, { ...st, msgs: [...(st.msgs ?? []), id].slice(-40) })
}

/** يمسح كل رسائل الشاشة الحالية (البوت والمستخدم) */
async function sweep(chat: number, keepState = false) {
  const st = await getState(chat)
  const ids = st.msgs ?? []
  await Promise.all(ids.map((id) => tg('deleteMessage', { chat_id: chat, message_id: id })))
  await putState(chat, keepState ? { ...st, msgs: [] } : { msgs: [] })
}

/** رسالة داخل معالج جارٍ — تُمسح عند انتهائه */
async function ask(chat: number, text: string, keyboard?: Row[]) {
  const r = await tg('sendMessage', {
    chat_id: chat, text, parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: kb(...keyboard) } : undefined,
  })
  await track(chat, r?.result?.message_id)
  return r
}

/** شاشة جديدة: تمسح ما قبلها ثم تعرض — هذا ما يبقي المحادثة نظيفة */
async function screen(chat: number, text: string, keyboard?: Row[], keepState = false) {
  await sweep(chat, keepState)
  return ask(chat, text, keyboard)
}

async function screenPhoto(chat: number, photo: string, caption: string, keyboard?: Row[]) {
  await sweep(chat)
  const r = await tg('sendPhoto', {
    chat_id: chat, photo, caption, parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: kb(...keyboard) } : undefined,
  })
  await track(chat, r?.result?.message_id)
  return r
}

const setFlow = async (chat: number, flow: string, step: string, data: Record<string, any> = {}) => {
  const st = await getState(chat)
  await putState(chat, { ...st, flow, step, data })
}

// ------------------------------------------------------------- القوائم
function mainMenu(admin: boolean): Row[] {
  const m: Row[] = [
    [['➕ إضافة منتج', 'f:addProduct'], ['📥 إضافة كمية', 'f:addStock']],
    [['📦 المخزون', 'm:stock'], ['🏷 الأصناف', 'm:cats']],
  ]
  if (admin) {
    m.push(
      [['🛍 الطلبات', 'r:orders'], ['🧾 فاتورة بيع', 'f:invoice']],
      [['💵 الأسعار', 'f:setPrice'], ['📊 المبيعات', 'm:sales']],
      [['📥 المشتريات', 'm:purch'], ['💳 الديون', 'm:debts']],
      [['💸 المصاريف', 'm:exp'], ['🚚 التوصيل', 'm:zones']],
      [['👥 المستخدمون', 'm:users']],
    )
  }
  return m
}

const HOME = (admin: boolean, name: string) =>
  `🏪 <b>أسواق الرفاعي</b>\nأهلاً ${name} — اختر ما تريد:`

// ==================================================== المعالج الرئيسي
Deno.serve(async (req) => {
  if (SECRET && req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('ok', { status: 200 })
  }

  let update: any
  try { update = await req.json() } catch { return new Response('ok') }

  const msg = update.message ?? update.edited_message
  const cbq = update.callback_query
  const from = msg?.from ?? cbq?.from
  const chat = msg?.chat?.id ?? cbq?.message?.chat?.id
  if (!from || !chat) return new Response('ok')

  try {
    const agent = await authorize(from, chat, msg)
    if (!agent) return new Response('ok')

    if (msg) await track(chat, msg.message_id)   // رسائل المستخدم تُمسح أيضاً

    if (cbq) {
      await tg('answerCallbackQuery', { callback_query_id: cbq.id })
      await onAction(chat, cbq.data ?? '', agent)
    } else if (msg) {
      await onMessage(chat, msg, agent)
    }
  } catch (e) {
    console.error('bot error', e)
    await tg('sendMessage', { chat_id: chat, text: '⚠️ صار خطأ. اكتب /start للبداية من جديد.' })
  }
  return new Response('ok')
})

// -------------------------------------------------------- التحقق والدور
type Agent = { telegram_id: number; agent_name: string; role: string }

async function authorize(from: any, chat: number, msg: any): Promise<Agent | null> {
  const { data: agent } = await db.from('telegram_agents')
    .select('telegram_id, agent_name, role, is_active').eq('telegram_id', from.id).maybeSingle()

  if (agent?.is_active) return agent as Agent
  if (agent) return null                                   // موقوف

  const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'مستخدم'

  // رمز دعوة صالح؟
  const code = String(msg?.text ?? '').trim().toUpperCase()
  if (/^[A-Z0-9]{6,10}$/.test(code)) {
    const { data: inv } = await db.from('telegram_invites')
      .select('*').eq('code', code).is('used_by', null).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (inv) {
      await db.from('telegram_agents').insert({
        telegram_id: from.id, agent_name: inv.label || fullName, role: inv.role, is_active: true,
      })
      await db.from('telegram_invites').update({ used_by: from.id, used_at: new Date().toISOString() }).eq('code', code)
      const isAdmin = inv.role === 'admin'
      await tg('sendMessage', {
        chat_id: chat, parse_mode: 'HTML',
        text: `✅ تم تفعيل حسابك بصفة <b>${isAdmin ? 'مدير' : 'مشرف إدخال'}</b>.`,
        reply_markup: { inline_keyboard: kb(...mainMenu(isAdmin)) },
      })
      return null   // الرسالة عُرضت — لا نكمل معالجة الرمز كنص
    }
  }

  // أول مستخدم على الإطلاق يُسجَّل مديراً، ثم يُقفل التسجيل
  const { count } = await db.from('telegram_agents').select('telegram_id', { count: 'exact', head: true })
  if ((count ?? 0) > 0) return null

  await db.from('telegram_agents').insert({
    telegram_id: from.id, agent_name: fullName, role: 'admin', is_active: true,
  })
  await db.from('app_settings').upsert([
    { key: 'telegram_chat_id', value: String(chat), updated_at: new Date().toISOString() },
  ])
  await tg('sendMessage', {
    chat_id: chat, parse_mode: 'HTML',
    text: `✅ تم تسجيلك مديراً يا <b>${fullName}</b>.\nإشعارات الطلبات ستصلك هنا.`,
  })
  return { telegram_id: from.id, agent_name: fullName, role: 'admin' }
}

// ======================================================= الرسائل النصية
async function onMessage(chat: number, msg: any, agent: Agent) {
  const text: string = (msg.text ?? msg.caption ?? '').trim()
  const admin = agent.role === 'admin'

  if (['/start', '/menu', 'القائمة', 'قائمة'].includes(text)) {
    return screen(chat, HOME(admin, agent.agent_name), mainMenu(admin))
  }
  if (['/cancel', 'إلغاء'].includes(text)) {
    return screen(chat, HOME(admin, agent.agent_name), mainMenu(admin))
  }

  const st = await getState(chat)
  const photo = msg.photo?.at(-1)?.file_id ?? null

  if (!st.flow) {
    if (text) return quickSearch(chat, text, admin)
    return screen(chat, HOME(admin, agent.agent_name), mainMenu(admin))
  }
  return runFlow(chat, st, { text, photo }, agent)
}

// ==================================================== أزرار القوائم
const ADMIN_ONLY = new Set([
  'prices', 'sales', 'purch', 'debts', 'exp', 'zones', 'invoice', 'users',
  'setPrice', 'salesDate', 'addExpense', 'addDebt', 'payDebt', 'purchase', 'invite',
  'orders', 'order', 'ostat', 'top', 'lowInvoice', 'purchases', 'debtRep', 'agents',
])

async function onAction(chat: number, action: string, agent: Agent) {
  const admin = agent.role === 'admin'
  const [ns, key, arg] = action.split(':')

  if (!admin && ADMIN_ONLY.has(key)) {
    return screen(chat, '🔒 هذا القسم للمدير فقط.', [backRow()])
  }

  if (ns === 'm') {
    switch (key) {
      case 'main': return screen(chat, HOME(admin, agent.agent_name), mainMenu(admin))
      case 'stock': return screen(chat, '📦 <b>المخزون</b>', [
        [['📋 المخزون الحالي', 'r:stock'], ['⚠️ النواقص', 'r:low']],
        [['➕ إضافة منتج', 'f:addProduct'], ['📥 إضافة كمية', 'f:addStock']],
        backRow()])
      case 'cats': return listCategories(chat)
      case 'sales': return screen(chat, '📊 <b>المبيعات</b>', [
        [['اليوم', 'r:sales:today'], ['أمس', 'r:sales:yesterday']],
        [['آخر 7 أيام', 'r:sales:week'], ['هذا الشهر', 'r:sales:month']],
        [['📅 بتاريخ محدد', 'f:salesDate'], ['🏆 الأكثر مبيعاً', 'r:top']],
        backRow()])
      case 'purch': return screen(chat, '📥 <b>المشتريات</b>', [
        [['🧾 فاتورة شراء جديدة', 'f:purchase']],
        [['⚠️ فاتورة نواقص مقترحة', 'r:lowInvoice']],
        [['📋 آخر الفواتير', 'r:purchases']],
        backRow()])
      case 'debts': return screen(chat, '💳 <b>دفتر الديون</b>', [
        [['➕ دَين جديد', 'f:addDebt'], ['💵 تسديد', 'f:payDebt']],
        [['📋 الديون المفتوحة', 'r:debts']],
        [['يومي', 'r:debtRep:1'], ['أسبوعي', 'r:debtRep:7']],
        [['شهري', 'r:debtRep:30'], ['سنوي', 'r:debtRep:365']],
        backRow()])
      case 'exp': return screen(chat, '💸 <b>المصاريف</b>', [
        [['➕ مصروف جديد', 'f:addExpense']],
        [['اليوم', 'r:exp:1'], ['هذا الشهر', 'r:exp:30']],
        backRow()])
      case 'zones': return listZones(chat)
      case 'users': return screen(chat, '👥 <b>المستخدمون</b>\nأضف مديراً أو مشرف إدخال برمز دعوة.', [
        [['➕ إضافة مدير', 'f:invite:admin']],
        [['➕ إضافة مشرف إدخال', 'f:invite:data_entry']],
        [['📋 المسجَّلون', 'r:agents']],
        backRow()])
    }
  }

  if (ns === 'f') return startFlow(chat, key, arg, agent)
  if (ns === 'r') return report(chat, key, arg, agent)

  if (ns === 'pick') {
    const st = await getState(chat)
    if (!st.flow) return screen(chat, HOME(admin, agent.agent_name), mainMenu(admin))
    return runFlow(chat, st, { pick: arg ?? key }, agent)
  }

  if (ns === 'zone') return startFlow(chat, 'setZoneFee', key, agent)
  if (ns === 'ord') return showOrder(chat, key, admin)
  if (ns === 'ost') return setOrderStatus(chat, key, arg!, admin)
  if (ns === 'agent') return toggleAgent(chat, Number(key), admin)
}

// ==================================================== بدء المعالجات
async function startFlow(chat: number, flow: string, arg: string | undefined, agent: Agent) {
  const admin = agent.role === 'admin'
  await sweep(chat)

  switch (flow) {
    case 'addProduct':
      await setFlow(chat, flow, 'barcode', {})
      return ask(chat,
        '➕ <b>منتج جديد</b> — الخطوة 1 من 7\n\n' +
        '📷 <b>صوّر الباركود</b> وأرسل الصورة، وسأقرأه بنفسي.\n' +
        'أو اكتب الرقم يدوياً إن كانت الصورة غير واضحة.',
        [[['⏭ بلا باركود', 'pick:skip']], cancelRow()])

    case 'addStock':
      await setFlow(chat, flow, 'find', {})
      return ask(chat, '📥 <b>إضافة كمية</b>\n\nأرسل <b>باركود</b> المنتج أو جزءاً من اسمه.\nأو صوّر الباركود.', [cancelRow()])

    case 'addCategory':
      await setFlow(chat, flow, 'name', {})
      return ask(chat, '🏷 أرسل <b>اسم الصنف</b> الجديد.', [cancelRow()])

    case 'setPrice':
      await setFlow(chat, flow, 'find', {})
      return ask(chat, '💵 <b>تسعير منتج</b>\n\nأرسل باركود المنتج أو جزءاً من اسمه.', [cancelRow()])

    case 'salesDate':
      await setFlow(chat, flow, 'date', {})
      return ask(chat, '📅 أرسل التاريخ بصيغة <code>YYYY-MM-DD</code>\nمثال: <code>2026-08-26</code>', [cancelRow()])

    case 'addExpense': {
      const { data: cats } = await db.from('expense_categories').select('id, name').order('sort_order')
      await setFlow(chat, flow, 'category', {})
      return ask(chat, '💸 <b>مصروف جديد</b>\n\nاختر النوع:',
        [...chunk((cats ?? []).map((c) => [c.name, `pick:${c.id}`] as [string, string]), 2), cancelRow()])
    }

    case 'addDebt':
      await setFlow(chat, flow, 'kind', {})
      return ask(chat, '💳 <b>دَين جديد</b>\n\nنوع الدَين:',
        [[['⬅️ لنا (على زبون)', 'pick:receivable']], [['➡️ علينا (لمورّد)', 'pick:payable']], cancelRow()])

    case 'payDebt': {
      const { data: open } = await db.from('debts_view')
        .select('id, party_name, remaining, kind').is('settled_at', null).order('created_at').limit(20)
      if (!open?.length) return screen(chat, '✅ لا توجد ديون مفتوحة.', [backRow()])
      await setFlow(chat, flow, 'pickDebt', {})
      return ask(chat, '💵 اختر الدَين للتسديد:', [
        ...open.map((d: any) => [[`${d.kind === 'receivable' ? '⬅️' : '➡️'} ${d.party_name} — ${iqd(d.remaining)}`, `pick:${d.id}`]] as Row),
        cancelRow()])
    }

    case 'purchase':
      await setFlow(chat, flow, 'supplier', { items: [] })
      return ask(chat, '📥 <b>فاتورة شراء</b>\n\nأرسل <b>اسم المورّد</b>.', [cancelRow()])

    case 'invoice':
      await setFlow(chat, flow, 'find', { items: [] })
      return ask(chat, '🧾 <b>فاتورة بيع</b>\n\nأرسل باركود المنتج أو جزءاً من اسمه لإضافته.', [cancelRow()])

    case 'setZoneFee':
      await setFlow(chat, flow, 'fee', { zoneId: arg })
      return ask(chat, '🚚 أرسل الأجرة الجديدة بالدينار (أرقام فقط).', [cancelRow()])

    case 'invite': {
      const role = arg === 'admin' ? 'admin' : 'data_entry'
      const code = Array.from({ length: 7 }, () =>
        'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')
      const { error } = await db.from('telegram_invites')
        .insert({ code, role, created_by: agent.telegram_id })
      if (error) return screen(chat, '⚠️ تعذّر توليد الرمز.', [backRow()])
      return screen(chat,
        `👥 <b>رمز دعوة ${role === 'admin' ? 'مدير' : 'مشرف إدخال'}</b>\n\n` +
        `<code>${code}</code>\n\n` +
        `أرسل هذا الرمز للشخص، ويرسله هو إلى البوت @marketrafaibot.\n` +
        `⏱ صالح 24 ساعة ولمرة واحدة فقط.`,
        [[['👥 المستخدمون', 'm:users']], backRow()])
    }
  }
  void admin
}

/** نموذج الأسعار والكميات: القيم ظاهرة، وكل حقل يُملأ بزره */
async function showProductForm(chat: number, d: Record<string, any>, admin: boolean, notice = '') {
  const piece = d.sellBy === 'piece'
  const money = (v: any) => (v === null || v === undefined || v === '' ? '—' : iqd(v))
  const count = (v: any) => (v === null || v === undefined || v === '' ? '—' : String(v))
  const mark = (f: string) => (d.field === f ? ' 👈' : '')

  const totalQty = (d.dozenQty ?? 0) * 12 + (d.pieceQty ?? 0)
  const perPiece = piece ? (d.wholesalePiece ?? null) : (d.dozenPrice ? Math.round(d.dozenPrice / 12) : null)

  const lines: string[] = [
    `➕ <b>${d.name}</b> — الخطوة 4`,
    `📦 نوع البيع: <b>${piece ? 'بالقطعة فقط' : 'بالدرزن والقطعة'}</b>`,
    '',
  ]
  if (admin) {
    lines.push(piece
      ? `💵 سعر الجملة للقطعة: <b>${money(d.wholesalePiece)}</b>${mark('wholesalePiece')}`
      : `💵 سعر الدرزن (جملة): <b>${money(d.dozenPrice)}</b>${mark('dozenPrice')}`)
    lines.push(`🏷 سعر القطعة (مفرد): <b>${money(d.retail)}</b>${mark('retail')}`, '')
  }
  if (!piece) lines.push(`📊 العدد الكلي بالدرزن: <b>${count(d.dozenQty)}</b>${mark('dozenQty')}`)
  lines.push(`🔢 العدد الكلي بالقطعة: <b>${count(d.pieceQty)}</b>${mark('pieceQty')}`)
  lines.push('', `📦 الإجمالي: <b>${totalQty}</b> قطعة`)
  if (admin && perPiece) lines.push(`ℹ️ الجملة للقطعة: ${iqd(perPiece)}`)
  if (d.field) lines.push('', `✍️ <b>أرسل الآن القيمة</b>`)
  if (notice) lines.push('', notice)

  const buttons: Row[] = []
  if (admin) {
    buttons.push(piece
      ? [['💵 سعر الجملة للقطعة', 'pick:f_wholesalePiece'], ['🏷 سعر القطعة', 'pick:f_retail']]
      : [['💵 سعر الدرزن', 'pick:f_dozenPrice'], ['🏷 سعر القطعة', 'pick:f_retail']])
  }
  buttons.push(piece
    ? [['🔢 العدد بالقطعة', 'pick:f_pieceQty']]
    : [['📊 العدد بالدرزن', 'pick:f_dozenQty'], ['🔢 العدد بالقطعة', 'pick:f_pieceQty']])
  buttons.push([[piece ? '🔁 يُباع بالدرزن أيضاً' : '🔁 يُباع بالقطعة فقط', 'pick:toggleSell']])
  buttons.push([['✅ متابعة للصورة', 'pick:next']])
  buttons.push(cancelRow())

  return screen(chat, lines.join('\n'), buttons, true)
}

const chunk = <T,>(a: T[], n: number): T[][] =>
  a.reduce<T[][]>((acc, x, i) => (i % n ? acc[acc.length - 1].push(x) : acc.push([x]), acc), [])

// ==================================================== تنفيذ المعالجات
type Input = { text?: string; photo?: string | null; pick?: string }

async function runFlow(chat: number, st: State, input: Input, agent: Agent) {
  const d = st.data ?? {}
  const t = (input.text ?? '').trim()
  const admin = agent.role === 'admin'
  const step = async (next: string, extra: Record<string, any> = {}) => {
    const cur = await getState(chat)
    await putState(chat, { ...cur, flow: st.flow, step: next, data: { ...d, ...extra } })
  }
  const done = () => screen(chat, HOME(admin, agent.agent_name), mainMenu(admin))

  switch (st.flow) {
    // ================================================ منتج جديد (7 خطوات)
    case 'addProduct': {
      if (st.step === 'barcode') {
        let code: string | null = null
        if (input.pick === 'skip') code = null
        else if (input.photo) {
          await ask(chat, '🔍 أقرأ الباركود من الصورة…')
          code = await readBarcodePhoto(input.photo)
          if (!code) {
            return ask(chat, '❌ لم أتمكّن من قراءة الباركود.\nصوّره أقرب وبإضاءة أفضل، أو <b>اكتب الرقم</b> يدوياً.',
              [[['⏭ بلا باركود', 'pick:skip']], cancelRow()])
          }
        } else if (t) code = t.replace(/\s/g, '')
        else return ask(chat, 'أرسل صورة الباركود أو اكتب الرقم.')

        if (code) {
          const { data: dup } = await db.from('products').select('id, name, quantity_single').eq('barcode', code).maybeSingle()
          if (dup) {
            await putState(chat, { flow: 'addStock', step: 'qty', data: { productId: dup.id, productName: dup.name, current: dup.quantity_single }, msgs: (await getState(chat)).msgs })
            return ask(chat,
              `ℹ️ هذا الباركود مسجَّل مسبقاً:\n📦 <b>${dup.name}</b> — الرصيد ${dup.quantity_single} قطعة\n\n` +
              `حوّلتك إلى <b>إضافة كمية</b>.\nأرسل الكمية بصيغة <b>درزن مفرد</b> (مثال <code>2 3</code>).`,
              [cancelRow()])
          }
        }
        await step('name', { barcode: code })
        return ask(chat, `✅ الباركود: <code>${code ?? 'بلا'}</code>\n\n<b>الخطوة 2 من 7</b> — أرسل <b>اسم المنتج</b>.`, [cancelRow()])
      }

      if (st.step === 'name') {
        if (!t) return ask(chat, 'الاسم مطلوب — أرسل اسم المنتج.')
        const { data: cats } = await db.from('categories').select('id, name').order('sort_order')
        await step('category', { name: t })
        return ask(chat, `<b>الخطوة 3 من 7</b> — اختر <b>الصنف</b>:`,
          [...chunk((cats ?? []).map((c) => [c.name, `pick:${c.id}`] as [string, string]), 2), cancelRow()])
      }

      if (st.step === 'category') {
        if (!input.pick) return ask(chat, 'اختر الصنف من الأزرار.')
        const seed = { categoryId: Number(input.pick), sellBy: 'dozen' }
        await step('form', seed)
        return showProductForm(chat, { ...d, ...seed }, admin)
      }

      // نموذج الأسعار والكميات — أزرار تُملأ بأي ترتيب
      if (st.step === 'form') {
        if (input.pick === 'toggleSell') {
          const sellBy = d.sellBy === 'piece' ? 'dozen' : 'piece'
          const extra: Record<string, any> = { sellBy, field: null }
          if (sellBy === 'piece') { extra.dozenPrice = null; extra.dozenQty = null }
          else extra.wholesalePiece = null
          await step('form', extra)
          return showProductForm(chat, { ...d, ...extra }, admin)
        }

        if (input.pick && input.pick.startsWith('f_')) {
          const field = input.pick.slice(2)
          await step('form', { field })
          return showProductForm(chat, { ...d, field }, admin)
        }

        if (input.pick === 'next') {
          const totalQty = (d.dozenQty ?? 0) * 12 + (d.pieceQty ?? 0)
          if (totalQty <= 0) return showProductForm(chat, d, admin, '⚠️ أدخل العدد أولاً — بالدرزن أو بالقطعة.')
          await step('photo', { field: null })
          return ask(chat, '📷 <b>الخطوة الأخيرة</b> — أرسل <b>صورة واضحة للمنتج</b>.',
            [[['⏭ بلا صورة', 'pick:skip']], cancelRow()])
        }

        if (t) {
          if (!d.field) return showProductForm(chat, d, admin, 'ℹ️ اضغط الحقل الذي تريد تعبئته أولاً.')
          const v = num(t)
          if (isNaN(v)) return showProductForm(chat, d, admin, '⚠️ أرسل رقماً — عربي أو لاتيني.')
          const extra: Record<string, any> = { [d.field]: v, field: null }
          await step('form', extra)
          return showProductForm(chat, { ...d, ...extra }, admin)
        }
        return showProductForm(chat, d, admin)
      }

      if (st.step === 'photo') {
        if (input.pick === 'skip') return finishProduct(chat, d, agent, null)
        if (!input.photo) return ask(chat, 'أرسل صورة المنتج، أو اضغط «بلا صورة».')
        return finishProduct(chat, d, agent, input.photo)
      }
      break
    }

    // ---------------------------------------------------- إضافة كمية
    case 'addStock': {
      if (st.step === 'find') {
        const term = input.photo ? (await readBarcodePhoto(input.photo)) : t
        if (!term) return ask(chat, '❌ لم أقرأ الباركود من الصورة. اكتبه يدوياً أو أرسل اسم المنتج.')
        const p = await findProduct(term)
        if (!p) return ask(chat, '❌ لم أجد منتجاً مطابقاً. جرّب اسماً أوضح أو الباركود.')
        await step('qty', { productId: p.id, productName: p.name, current: p.quantity_single })
        return ask(chat, `📦 <b>${p.name}</b>\nالرصيد الحالي: <b>${p.quantity_single}</b> قطعة\n\nأرسل الكمية المضافة <code>درزن مفرد</code> (مثال <code>2 3</code>).`, [cancelRow()])
      }
      if (st.step === 'qty') {
        const q = parseQty(t)
        if (!q) return ask(chat, 'صيغة غير مفهومة. مثال: <code>2 3</code> أو <code>15</code>.')
        const { error } = await db.from('stock_movements').insert({
          product_id: d.productId, type: 'stock_in',
          dozen_qty: q.dozen, singles_qty: q.singles,
          source: 'telegram_bot', note: `عبر البوت — ${agent.agent_name}`,
        })
        if (error) return screen(chat, '⚠️ تعذّر الحفظ: ' + error.message, [backRow()])
        const total = q.dozen * 12 + q.singles
        return screen(chat,
          `✅ <b>تمت الإضافة</b>\n\n📦 ${d.productName}\n➕ ${total} قطعة\n📊 الرصيد الجديد: <b>${d.current + total}</b> قطعة`,
          [[['📥 إضافة كمية أخرى', 'f:addStock']], backRow()])
      }
      break
    }

    // ------------------------------------------------------ صنف جديد
    case 'addCategory': {
      if (!t) return ask(chat, 'أرسل اسم الصنف.')
      const { error } = await db.from('categories').insert({ name: t, sort_order: 99 })
      if (error) return screen(chat, '⚠️ الصنف موجود مسبقاً.', [[['🏷 الأصناف', 'm:cats']], backRow()])
      return listCategories(chat, `✅ أُضيف الصنف <b>${t}</b>.\n\n`)
    }

    // --------------------------------------------------------- تسعير
    case 'setPrice': {
      if (st.step === 'find') {
        const term = input.photo ? (await readBarcodePhoto(input.photo)) : t
        const p = term ? await findProduct(term) : null
        if (!p) return ask(chat, '❌ لم أجد منتجاً مطابقاً.')
        const { data: pr } = await db.from('product_prices').select('*').eq('product_id', p.id).maybeSingle()
        await step('retail', { productId: p.id, productName: p.name })
        return ask(chat,
          `💵 <b>${p.name}</b>\nالمفرد الحالي: ${iqd(pr?.price_retail ?? 0)}\nالجملة الحالية: ${iqd(pr?.price_wholesale ?? 0)} للقطعة\n\nأرسل <b>سعر المفرد</b> الجديد.`,
          [cancelRow()])
      }
      if (st.step === 'retail') {
        const v = num(t)
        if (isNaN(v)) return ask(chat, 'أرسل رقماً.')
        await step('wholesale', { retail: v })
        return ask(chat, 'أرسل <b>سعر الدرزن</b> (سيُقسَّم على 12).', [cancelRow()])
      }
      if (st.step === 'wholesale') {
        const v = num(t)
        if (isNaN(v)) return ask(chat, 'أرسل رقماً.')
        const wholesale = Math.round(v / 12)
        const { error } = await db.from('product_prices').upsert({
          product_id: d.productId, price_retail: d.retail, price_wholesale: wholesale,
          updated_at: new Date().toISOString(),
        })
        if (error) return screen(chat, '⚠️ تعذّر الحفظ.', [backRow()])
        return screen(chat,
          `✅ <b>${d.productName}</b>\n\n🏷 المفرد: <b>${iqd(d.retail)}</b>\n📦 الجملة: <b>${iqd(wholesale)}</b> للقطعة (${iqd(v)} للدرزن)`,
          [[['💵 تسعير منتج آخر', 'f:setPrice']], backRow()])
      }
      break
    }

    case 'salesDate': {
      if (!isDate(t)) return ask(chat, 'الصيغة: <code>YYYY-MM-DD</code>')
      return sendSales(chat, t.trim(), t.trim(), `مبيعات ${t.trim()}`)
    }

    // --------------------------------------------------------- مصروف
    case 'addExpense': {
      if (st.step === 'category') {
        if (!input.pick) return ask(chat, 'اختر النوع من الأزرار.')
        await step('amount', { categoryId: Number(input.pick) })
        return ask(chat, 'أرسل <b>المبلغ</b> بالدينار.', [cancelRow()])
      }
      if (st.step === 'amount') {
        const v = num(t)
        if (isNaN(v) || v <= 0) return ask(chat, 'أرسل مبلغاً صحيحاً.')
        await step('note', { amount: v })
        return ask(chat, 'أرسل <b>ملاحظة</b> أو تخطَّ.', [[['⏭ تخطي', 'pick:skip']], cancelRow()])
      }
      if (st.step === 'note') {
        const note = input.pick === 'skip' ? null : t || null
        const { error } = await db.from('expenses')
          .insert({ category_id: d.categoryId, amount: d.amount, note, spent_on: today() })
        if (error) return screen(chat, '⚠️ تعذّر الحفظ.', [backRow()])
        return screen(chat, `✅ سُجّل مصروف <b>${iqd(d.amount)}</b>.`,
          [[['💸 مصروف آخر', 'f:addExpense'], ['📋 مصاريف اليوم', 'r:exp:1']], backRow()])
      }
      break
    }

    // ---------------------------------------------------------- ديون
    case 'addDebt': {
      if (st.step === 'kind') {
        if (!input.pick) return ask(chat, 'اختر النوع.')
        await step('party', { kind: input.pick })
        return ask(chat, 'أرسل <b>اسم الطرف</b> (الزبون أو المورّد).', [cancelRow()])
      }
      if (st.step === 'party') {
        if (!t) return ask(chat, 'الاسم مطلوب.')
        await step('amount', { party: t })
        return ask(chat, 'أرسل <b>المبلغ</b> بالدينار.', [cancelRow()])
      }
      if (st.step === 'amount') {
        const v = num(t)
        if (isNaN(v) || v <= 0) return ask(chat, 'أرسل مبلغاً صحيحاً.')
        await step('due', { amount: v })
        return ask(chat, 'أرسل <b>تاريخ الاستحقاق</b> <code>YYYY-MM-DD</code> أو تخطَّ.',
          [[['⏭ بلا تاريخ', 'pick:skip']], cancelRow()])
      }
      if (st.step === 'due') {
        const due = input.pick === 'skip' ? null : (isDate(t) ? t.trim() : null)
        if (input.pick !== 'skip' && !due) return ask(chat, 'الصيغة: <code>YYYY-MM-DD</code> أو اضغط تخطي.')
        const { error } = await db.from('debts').insert({
          kind: d.kind, party_name: d.party, amount: d.amount, due_on: due,
          note: `عبر البوت — ${agent.agent_name}`,
        })
        if (error) return screen(chat, '⚠️ تعذّر الحفظ.', [backRow()])
        return screen(chat,
          `✅ سُجّل دَين ${d.kind === 'receivable' ? '<b>لنا على</b>' : '<b>علينا لـ</b>'} ${d.party}\n💰 ${iqd(d.amount)}${due ? `\n📅 الاستحقاق: ${due}` : ''}`,
          [[['💳 الديون المفتوحة', 'r:debts']], backRow()])
      }
      break
    }

    case 'payDebt': {
      if (st.step === 'pickDebt') {
        if (!input.pick) return ask(chat, 'اختر الدَين من الأزرار.')
        const { data: debt } = await db.from('debts_view').select('*').eq('id', input.pick).maybeSingle()
        if (!debt) return ask(chat, '❌ لم أجد الدَين.')
        await step('amount', { debtId: debt.id, remaining: debt.remaining, party: debt.party_name })
        return ask(chat, `💳 <b>${debt.party_name}</b>\nالمتبقي: <b>${iqd(debt.remaining)}</b>\n\nأرسل <b>المبلغ المسدَّد</b>.`, [cancelRow()])
      }
      if (st.step === 'amount') {
        const v = num(t)
        if (isNaN(v) || v <= 0) return ask(chat, 'أرسل مبلغاً صحيحاً.')
        const { error } = await db.from('debt_payments')
          .insert({ debt_id: d.debtId, amount: v, paid_on: today(), note: `عبر البوت — ${agent.agent_name}` })
        if (error) return screen(chat, '⚠️ تعذّر الحفظ.', [backRow()])
        const left = Math.max(0, d.remaining - v)
        return screen(chat,
          `✅ سُدّد <b>${iqd(v)}</b> من دَين ${d.party}\n${left > 0 ? `المتبقي: <b>${iqd(left)}</b>` : '🎉 سُدّد بالكامل.'}`,
          [[['💵 تسديد آخر', 'f:payDebt'], ['📋 الديون', 'r:debts']], backRow()])
      }
      break
    }

    // ----------------------------------------------------- فاتورة شراء
    case 'purchase': {
      if (st.step === 'supplier') {
        if (!t) return ask(chat, 'أرسل اسم المورّد.')
        await step('item', { supplier: t })
        return ask(chat, `🧾 المورّد: <b>${t}</b>\n\nأرسل باركود المنتج أو اسمه لإضافته.`,
          [[['✅ إنهاء الفاتورة', 'pick:done']], cancelRow()])
      }
      if (st.step === 'item') {
        if (input.pick === 'done') return finishPurchase(chat, d, agent)
        const term = input.photo ? (await readBarcodePhoto(input.photo)) : t
        const p = term ? await findProduct(term) : null
        if (!p) return ask(chat, '❌ لم أجد منتجاً مطابقاً.')
        await step('itemQty', { cur: { id: p.id, name: p.name } })
        return ask(chat, `📦 <b>${p.name}</b>\nأرسل الكمية <code>درزن مفرد</code> (مثال <code>3 0</code>).`, [cancelRow()])
      }
      if (st.step === 'itemQty') {
        const q = parseQty(t)
        if (!q) return ask(chat, 'مثال: <code>3 0</code> أو <code>36</code>.')
        await step('itemCost', { curQty: q })
        return ask(chat, 'أرسل <b>كلفة القطعة</b> بالدينار.', [cancelRow()])
      }
      if (st.step === 'itemCost') {
        const v = num(t)
        if (isNaN(v)) return ask(chat, 'أرسل رقماً.')
        const items = [...(d.items ?? []), { ...d.cur, ...d.curQty, cost: v }]
        await step('item', { items, cur: null, curQty: null })
        const total = items.reduce((s: number, i: any) => s + (i.dozen * 12 + i.singles) * i.cost, 0)
        return ask(chat, `✅ أُضيف — البنود: <b>${items.length}</b> · المجموع: <b>${iqd(total)}</b>\n\nأرسل منتجاً آخر أو أنهِ الفاتورة.`,
          [[['✅ إنهاء الفاتورة', 'pick:done']], cancelRow()])
      }
      break
    }

    // ----------------------------------------------------- فاتورة بيع
    case 'invoice': {
      if (st.step === 'find') {
        if (input.pick === 'done') {
          if (!(d.items ?? []).length) return ask(chat, 'الفاتورة فارغة — أضف منتجاً أولاً.')
          await step('customer')
          return ask(chat, 'أرسل <b>اسم الزبون</b>.', [cancelRow()])
        }
        const term = input.photo ? (await readBarcodePhoto(input.photo)) : t
        const p = term ? await findProduct(term) : null
        if (!p) return ask(chat, '❌ لم أجد منتجاً مطابقاً.')
        const { data: pr } = await db.from('product_prices').select('price_retail').eq('product_id', p.id).maybeSingle()
        await step('itemQty', { cur: { id: p.id, name: p.name, price: pr?.price_retail ?? 0, stock: p.quantity_single } })
        return ask(chat, `🧾 <b>${p.name}</b> — ${iqd(pr?.price_retail ?? 0)} للقطعة\nالمتوفر: ${p.quantity_single}\n\nأرسل <b>عدد القطع</b>.`, [cancelRow()])
      }
      if (st.step === 'itemQty') {
        const v = num(t)
        if (isNaN(v) || v <= 0) return ask(chat, 'أرسل عدداً صحيحاً.')
        if (v > d.cur.stock) return ask(chat, `⚠️ المتوفر ${d.cur.stock} قطعة فقط.`)
        const items = [...(d.items ?? []), { ...d.cur, qty: v }]
        const total = items.reduce((s: number, i: any) => s + i.qty * i.price, 0)
        await step('find', { items, cur: null })
        return ask(chat, `✅ أُضيف — المجموع: <b>${iqd(total)}</b>\n\nأرسل منتجاً آخر أو أنهِ الفاتورة.`,
          [[['✅ إنهاء الفاتورة', 'pick:done']], cancelRow()])
      }
      if (st.step === 'customer') {
        if (!t) return ask(chat, 'أرسل اسم الزبون.')
        await step('payment', { customer: t })
        return ask(chat, 'طريقة الدفع:', [[['💵 نقد', 'pick:cash'], ['📝 آجل (دَين)', 'pick:debt']], cancelRow()])
      }
      if (st.step === 'payment') {
        if (!input.pick) return ask(chat, 'اختر طريقة الدفع.')
        return finishInvoice(chat, d, input.pick, agent)
      }
      break
    }

    // ------------------------------------------- تسعير بند «يُحدَّد عند التأكيد»
    case 'priceItem': {
      if (st.step === 'pick') {
        if (!input.pick) return
        const item = (d.unpriced ?? [])[Number(input.pick)]
        if (!item) return
        await step('amount', { item })
        return ask(chat,
          `🏷 <b>${item.name}</b>\nالكمية: <b>${item.qty}</b> قطعة\n\nأرسل <b>سعر القطعة</b> بالدينار.`,
          [cancelRow()])
      }
      if (st.step === 'amount') {
        const v = num(t)
        if (isNaN(v) || v <= 0) return ask(chat, 'أرسل سعراً أكبر من صفر.')
        await step('save', { price: v })
        return ask(chat,
          `السعر: <b>${iqd(v)}</b> × ${d.item.qty} = <b>${iqd(v * d.item.qty)}</b>\n\nهل أعتمد هذا السعر للمنتج نفسه في المتجر؟`,
          [[['✅ نعم، اعتمده', 'pick:yes'], ['🚫 لهذا الطلب فقط', 'pick:no']], cancelRow()])
      }
      if (st.step === 'save') {
        if (!input.pick) return
        const { error } = await db.rpc('price_order_item', {
          p_order_id: d.orderId, p_product_id: d.item.product_id,
          p_unit_price: d.price, p_save_to_product: input.pick === 'yes',
        })
        if (error) return screen(chat, '⚠️ تعذّر التسعير: ' + error.message, [backRow()])
        return showOrder(chat, d.orderId, admin)
      }
      break
    }

    case 'setZoneFee': {
      const v = num(t)
      if (isNaN(v)) return ask(chat, 'أرسل رقماً.')
      const { error } = await db.from('delivery_zones').update({ fee: v }).eq('id', Number(d.zoneId))
      if (error) return screen(chat, '⚠️ تعذّر الحفظ.', [backRow()])
      return listZones(chat, `✅ صارت الأجرة ${iqd(v)}.\n\n`)
    }
  }
  return done()
}

// ------------------------------------------------------------ إنهاءات
async function finishProduct(chat: number, d: any, agent: Agent, photoId: string | null) {
  const piece = d.sellBy === 'piece'
  const dozenQty = piece ? 0 : (d.dozenQty ?? 0)
  const pieceQty = d.pieceQty ?? 0
  const total = dozenQty * 12 + pieceQty
  const retail = d.retail ?? 0
  const wholesalePiece = piece
    ? (d.wholesalePiece ?? 0)
    : (d.dozenPrice ? Math.round(d.dozenPrice / 12) : 0)

  const { data: product, error } = await db.from('products')
    .insert({
      barcode: d.barcode, name: d.name, category_id: d.categoryId,
      sold_by: piece ? 'piece' : 'dozen',
    })
    .select('id, code').single()

  if (error || !product) {
    return screen(chat, '⚠️ تعذّرت الإضافة: ' + (error?.message ?? ''), [backRow()])
  }

  let imageUrl: string | null = null
  if (photoId) imageUrl = await uploadPhoto(photoId, product.id)
  if (imageUrl) await db.from('products').update({ image_url: imageUrl }).eq('id', product.id)

  if (total > 0) {
    await db.from('stock_movements').insert({
      product_id: product.id, type: 'stock_in',
      dozen_qty: dozenQty, singles_qty: pieceQty,
      source: 'telegram_bot', note: `عبر البوت — ${agent.agent_name}`,
    })
  }

  if (agent.role === 'admin') {
    await db.from('product_prices').upsert({
      product_id: product.id, price_retail: retail, price_wholesale: wholesalePiece,
      updated_at: new Date().toISOString(),
    })
  }

  // تأكيد الظهور فعلياً في المتجر (لا وعد نظري)
  const { data: live } = await db.from('storefront_products').select('id').eq('id', product.id).maybeSingle()
  const visible = Boolean(live)

  const priceLines = agent.role === 'admin'
    ? `🏷 سعر القطعة: <b>${iqd(retail)}</b>\n` +
      (piece
        ? `💵 سعر الجملة للقطعة: <b>${iqd(wholesalePiece)}</b>\n`
        : `💵 سعر الدرزن: <b>${iqd(d.dozenPrice ?? 0)}</b> (${iqd(wholesalePiece)} للقطعة)\n`)
    : ''

  const caption =
    `✅ <b>أُضيف المنتج</b>\n\n` +
    `📦 <b>${d.name}</b>\n` +
    `🔖 الباركود: <code>${d.barcode ?? 'بلا'}</code>\n` +
    `🛒 نوع البيع: <b>${piece ? 'بالقطعة فقط' : 'بالدرزن والقطعة'}</b>\n` +
    `📊 الكمية: <b>${total}</b> قطعة` +
    (dozenQty ? ` (${dozenQty} درزن + ${pieceQty} قطعة)` : '') + `\n` +
    priceLines +
    `🖼 الصورة: ${imageUrl ? '✅ مرفوعة' : '—'}\n\n` +
    (visible
      ? `🟢 <b>ظاهر الآن في المتجر</b>`
      : `🟡 <b>غير ظاهر في المتجر</b> — السعر 0 يعني «السعر عند الطلب».`) +
    (STORE_URL ? `\n\n🔗 صفحة المنتج — أرسلها للزبون:\n${STORE_URL}/p/${product.code}` : '')

  const buttons: Row[] = [
    STORE_URL ? [['🔗 فتح صفحة المنتج', `${STORE_URL}/p/${product.code}`]] : [],
    [['➕ منتج آخر', 'f:addProduct'], ['💵 تعديل السعر', 'f:setPrice']],
    backRow(),
  ]

  return imageUrl
    ? screenPhoto(chat, imageUrl, caption, buttons)
    : screen(chat, caption, buttons)
}

async function finishPurchase(chat: number, d: any, agent: Agent) {
  const items = d.items ?? []
  if (!items.length) return ask(chat, 'الفاتورة فارغة — أضف بنداً أولاً.')

  const { data: purchase, error } = await db.from('purchases')
    .insert({ supplier_name: d.supplier, status: 'draft' }).select('id, purchase_number').single()
  if (error || !purchase) return screen(chat, '⚠️ تعذّر الحفظ.', [backRow()])

  await db.from('purchase_items').insert(items.map((i: any) => ({
    purchase_id: purchase.id, product_id: i.id, name: i.name,
    dozen_qty: i.dozen, singles_qty: i.singles, unit_cost: i.cost,
  })))
  await db.from('purchases').update({ status: 'received' }).eq('id', purchase.id)

  const total = items.reduce((s: number, i: any) => s + (i.dozen * 12 + i.singles) * i.cost, 0)
  const lines = items.map((i: any, n: number) =>
    `${n + 1}. ${i.name} — ${i.dozen * 12 + i.singles} قطعة × ${iqd(i.cost)} = ${iqd((i.dozen * 12 + i.singles) * i.cost)}`).join('\n')

  void agent
  return screen(chat,
    `✅ <b>فاتورة شراء #${purchase.purchase_number}</b>\n🚚 المورّد: ${d.supplier}\n\n${lines}\n\n💰 المجموع: <b>${iqd(total)}</b>\n📦 أُضيفت الكميات للمخزون.`,
    [[['🧾 فاتورة أخرى', 'f:purchase']], backRow()])
}

async function finishInvoice(chat: number, d: any, payment: string, agent: Agent) {
  const items = d.items ?? []
  const subtotal = items.reduce((s: number, i: any) => s + i.qty * i.price, 0)

  const { data: order, error } = await db.from('orders').insert({
    customer_name: d.customer, customer_phone: '—', mode: 'retail',
    subtotal, delivery_fee: 0, total_amount: subtotal,
    delivery_zone: 'بيع مباشر في المحل', source: 'pos', payment,
    items_json: items.map((i: any) => ({
      product_id: i.id, name: i.name, qty: i.qty,
      unit_price: i.price, line_total: i.qty * i.price, price_on_request: i.price === 0,
    })),
  }).select('id, order_number').single()

  if (error || !order) return screen(chat, '⚠️ تعذّر إصدار الفاتورة: ' + (error?.message ?? ''), [backRow()])

  for (const i of items) {
    await db.from('stock_movements').insert({
      product_id: i.id, type: 'sale', dozen_qty: 0, singles_qty: -i.qty,
      source: 'pos', order_id: order.id, note: `فاتورة #${order.order_number}`,
    })
  }

  const lines = items.map((i: any, n: number) =>
    `${n + 1}. ${i.name} — ${i.qty} × ${iqd(i.price)} = ${iqd(i.qty * i.price)}`).join('\n')

  void agent
  return screen(chat,
    `🧾 <b>فاتورة #${order.order_number}</b>\nأسواق الرفاعي — الرمادي، شارع السينما\n` +
    `👤 ${d.customer}\n💳 ${payment === 'debt' ? 'آجل (سُجّل ديناً)' : 'نقد'}\n\n${lines}\n\n` +
    `💰 <b>المجموع: ${iqd(subtotal)}</b>\n📦 خُصمت الكميات من المخزون.`,
    [[['🧾 فاتورة أخرى', 'f:invoice']], backRow()])
}

// -------------------------------------------------------------- الطلبات
const OSTAT: Record<string, string> = {
  new: '🔵 جديد', confirmed: '🟠 مؤكد', delivered: '🟢 مُسلَّم', cancelled: '🔴 ملغى',
}

async function listOrders(chat: number) {
  const { data } = await db.from('orders')
    .select('id, order_number, customer_name, total_amount, status, created_at, source')
    .order('created_at', { ascending: false }).limit(15)

  if (!data?.length) return screen(chat, '🛍 لا توجد طلبات بعد.', [backRow()])

  const newCount = data.filter((o: any) => o.status === 'new').length
  return screen(chat,
    `🛍 <b>آخر الطلبات</b>\n${newCount ? `🔵 <b>${newCount}</b> طلب جديد بانتظارك` : '✅ لا طلبات جديدة'}\n\nاضغط طلباً لعرضه:`,
    [...data.map((o: any) =>
      [[`#${o.order_number} · ${o.customer_name} · ${iqd(o.total_amount)} · ${OSTAT[o.status].slice(0, 2)}`, `ord:${o.id}`]] as Row),
      backRow()])
}

async function showOrder(chat: number, id: string, admin: boolean) {
  if (!admin) return
  const { data: o } = await db.from('orders').select('*').eq('id', id).maybeSingle()
  if (!o) return screen(chat, '❌ لم أجد الطلب.', [backRow()])

  const items = (o.items_json ?? []) as any[]
  const lines = items.map((i: any, n: number) =>
    `${n + 1}. ${i.name} — ${o.mode === 'wholesale' && i.qty % 12 === 0 ? `${i.qty / 12} درزن` : `${i.qty} قطعة`}` +
    (i.price_on_request ? ' — ⚠️ يُحدَّد عند التأكيد' : ` = ${iqd(i.line_total)}`)).join('\n')

  const unpriced = items.filter((i: any) => i.price_on_request)
  const phone = String(o.customer_phone ?? '').replace(/\D/g, '').replace(/^0/, '964')

  // حالة المعالج تُحفظ لتعمل أزرار التسعير أدناه
  const cur = await getState(chat)
  await putState(chat, {
    ...cur, flow: 'priceItem', step: 'pick',
    data: { orderId: o.id, unpriced: unpriced.map((i: any) => ({ product_id: i.product_id, name: i.name, qty: i.qty })) },
  })

  const buttons: Row[] = [
    ...unpriced.map((i: any, n: number) => [[`🏷 تسعير: ${i.name}`, `pick:${n}`]] as Row),
    [['🟠 مؤكد', `ost:${o.id}:confirmed`], ['🟢 مُسلَّم', `ost:${o.id}:delivered`]],
    [['🔴 إلغاء الطلب', `ost:${o.id}:cancelled`]],
    phone.length >= 10 ? [['💬 مراسلة الزبون', `https://wa.me/${phone}`]] : [],
    [['⬅️ كل الطلبات', 'r:orders']],
    backRow(),
  ]

  return screen(chat,
    `🧾 <b>طلب #${o.order_number}</b> — ${OSTAT[o.status]}\n` +
    `📅 ${new Date(o.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}\n\n` +
    `👤 ${o.customer_name}\n📱 <code>${o.customer_phone}</code>\n` +
    `📍 ${o.delivery_zone ?? '—'}\n` +
    (o.customer_note ? `📝 ${o.customer_note}\n` : '') +
    `🛒 ${o.mode === 'wholesale' ? 'جملة' : 'مفرد'} · ${o.payment === 'debt' ? 'آجل' : 'نقد'}\n\n` +
    `${lines}\n\n` +
    `البضاعة: ${iqd(o.subtotal)}\nالتوصيل: ${iqd(o.delivery_fee)}\n💰 <b>المجموع: ${iqd(o.total_amount)}</b>` +
    (unpriced.length ? `\n\n⚠️ <b>${unpriced.length}</b> بند بلا سعر — سعّره ليكتمل المجموع.` : ''),
    buttons, true)
}

async function setOrderStatus(chat: number, id: string, status: string, admin: boolean) {
  if (!admin) return
  const { error } = await db.from('orders').update({ status }).eq('id', id)
  if (error) return screen(chat, '⚠️ تعذّر التغيير: ' + error.message, [backRow()])
  await showOrder(chat, id, admin)
}

// ------------------------------------------------------------- تقارير
async function report(chat: number, key: string, arg: string | undefined, agent: Agent) {
  const admin = agent.role === 'admin'

  switch (key) {
    case 'orders': return listOrders(chat)

    case 'agents': {
      const { data } = await db.from('telegram_agents')
        .select('telegram_id, agent_name, role, is_active').order('created_at')
      return screen(chat, '👥 <b>المسجَّلون في البوت</b>\nاضغط على أحدهم لإيقافه أو تفعيله:',
        [...(data ?? []).map((a: any) =>
          [[`${a.is_active ? '🟢' : '⏸'} ${a.agent_name} — ${a.role === 'admin' ? 'مدير' : 'مشرف'}`, `agent:${a.telegram_id}`]] as Row),
          [['➕ إضافة مدير', 'f:invite:admin']],
          [['➕ إضافة مشرف', 'f:invite:data_entry']],
          backRow()])
    }

    case 'sales': {
      if (arg === 'today') return sendSales(chat, today(), today(), 'مبيعات اليوم')
      if (arg === 'yesterday') return sendSales(chat, shift(1), shift(1), 'مبيعات أمس')
      if (arg === 'week') return sendSales(chat, shift(6), today(), 'مبيعات آخر 7 أيام')
      return sendSales(chat, monthStart(), today(), 'مبيعات هذا الشهر')
    }

    case 'top': {
      const { data } = await db.rpc('top_products', { p_from: monthStart(), p_to: today(), p_limit: 10 })
      if (!data?.length) return screen(chat, '📊 لا مبيعات هذا الشهر.', [backRow()])
      return screen(chat, '🏆 <b>الأكثر مبيعاً هذا الشهر</b>\n\n' +
        data.map((r: any, i: number) => `${i + 1}. ${r.name} — ${r.qty} قطعة (${iqd(r.revenue)})`).join('\n'),
        [[['📊 المبيعات', 'm:sales']], backRow()])
    }

    case 'stock': {
      const { data } = await db.from('products')
        .select('name, quantity_single').eq('is_active', true)
        .order('quantity_single', { ascending: false }).limit(40)
      const total = (data ?? []).reduce((s, p: any) => s + p.quantity_single, 0)
      return screen(chat,
        `📋 <b>المخزون الحالي</b>\nالإجمالي: <b>${total}</b> قطعة · المعروض: أعلى ${(data ?? []).length}\n\n` +
        (data ?? []).map((p: any) => `• ${p.name} — <b>${p.quantity_single}</b>`).join('\n'),
        [[['⚠️ النواقص', 'r:low']], backRow()])
    }

    case 'low': {
      const { data } = await db.rpc('low_stock', { p_threshold: 12 })
      if (!data?.length) return screen(chat, '✅ لا نواقص — المخزون بخير.', [backRow()])
      return screen(chat, '⚠️ <b>نواقص المخزون</b> (درزن أو أقل)\n\n' +
        data.map((p: any) => `• ${p.name} — <b>${p.quantity_single}</b> قطعة`).join('\n'),
        [admin ? [['🧾 فاتورة نواقص', 'r:lowInvoice']] : [], [['📥 إضافة كمية', 'f:addStock']], backRow()])
    }

    case 'lowInvoice': {
      const { data } = await db.rpc('low_stock', { p_threshold: 12 })
      if (!data?.length) return screen(chat, '✅ لا نواقص تستدعي شراء.', [backRow()])
      const lines = data.map((p: any, i: number) =>
        `${i + 1}. ${p.name} — المتوفر ${p.quantity_single} — المقترح ${Math.max(1, Math.ceil((24 - p.quantity_single) / 12))} درزن`).join('\n')
      return screen(chat, `🧾 <b>قائمة مشتريات مقترحة</b>\nالهدف: رفع كل صنف إلى درزنين.\n\n${lines}`,
        [[['🧾 فاتورة شراء', 'f:purchase']], backRow()])
    }

    case 'purchases': {
      const { data } = await db.from('purchases')
        .select('purchase_number, supplier_name, total_amount, status')
        .order('created_at', { ascending: false }).limit(10)
      if (!data?.length) return screen(chat, '📥 لا فواتير شراء بعد.', [backRow()])
      return screen(chat, '📥 <b>آخر فواتير الشراء</b>\n\n' + data.map((p: any) =>
        `#${p.purchase_number} — ${p.supplier_name ?? '—'} — ${iqd(p.total_amount)} — ${p.status === 'received' ? '✅' : p.status}`).join('\n'),
        [[['🧾 فاتورة جديدة', 'f:purchase']], backRow()])
    }

    case 'debts': {
      const { data } = await db.from('debts_view').select('*').is('settled_at', null)
        .order('due_on', { nullsFirst: false }).limit(30)
      if (!data?.length) return screen(chat, '✅ لا ديون مفتوحة.', [backRow()])
      const us = data.filter((d: any) => d.kind === 'receivable')
      const them = data.filter((d: any) => d.kind === 'payable')
      const fmt = (l: any[]) => l.map((d) =>
        `• ${d.party_name} — <b>${iqd(d.remaining)}</b>${d.overdue ? ' ⚠️ متأخر' : d.due_on ? ` (${d.due_on})` : ''}`).join('\n')
      return screen(chat,
        `💳 <b>الديون المفتوحة</b>\n\n<b>لنا (${us.length}):</b>\n${fmt(us) || '—'}\n\n<b>علينا (${them.length}):</b>\n${fmt(them) || '—'}\n\n` +
        `📌 مجموع ما لنا: <b>${iqd(us.reduce((s, d: any) => s + Number(d.remaining), 0))}</b>`,
        [[['💵 تسديد', 'f:payDebt'], ['➕ دَين جديد', 'f:addDebt']], backRow()])
    }

    case 'debtRep': {
      const days = Number(arg ?? 1)
      const from = days === 1 ? today() : shift(days - 1)
      const [{ data: added }, { data: paid }, { data: open }] = await Promise.all([
        db.from('debts').select('amount, kind').gte('created_at', from),
        db.from('debt_payments').select('amount').gte('paid_on', from),
        db.from('debts_view').select('remaining, kind, overdue').is('settled_at', null),
      ])
      const label = ({ 1: 'اليوم', 7: 'الأسبوع', 30: 'الشهر', 365: 'السنة' } as any)[days] ?? `${days} يوم`
      const newUs = (added ?? []).filter((d: any) => d.kind === 'receivable').reduce((s, d: any) => s + d.amount, 0)
      const newThem = (added ?? []).filter((d: any) => d.kind === 'payable').reduce((s, d: any) => s + d.amount, 0)
      const collected = (paid ?? []).reduce((s, p: any) => s + p.amount, 0)
      const totalOpen = (open ?? []).filter((d: any) => d.kind === 'receivable').reduce((s, d: any) => s + Number(d.remaining), 0)
      const overdue = (open ?? []).filter((d: any) => d.kind === 'receivable' && d.overdue).reduce((s, d: any) => s + Number(d.remaining), 0)
      return screen(chat,
        `💳 <b>دفتر الديون — ${label}</b>\n\n` +
        `➕ ديون جديدة لنا: <b>${iqd(newUs)}</b>\n➕ ديون جديدة علينا: <b>${iqd(newThem)}</b>\n` +
        `💵 المُحصَّل: <b>${iqd(collected)}</b>\n\n📌 المفتوح لنا: <b>${iqd(totalOpen)}</b>\n` +
        (overdue > 0 ? `⚠️ منها متأخر: <b>${iqd(overdue)}</b>` : '✅ لا ديون متأخرة'),
        [[['💳 الديون', 'm:debts']], backRow()])
    }

    case 'exp': {
      const days = Number(arg ?? 1)
      const from = days === 1 ? today() : shift(days - 1)
      const { data } = await db.from('expenses')
        .select('amount, note, spent_on, expense_categories(name)')
        .gte('spent_on', from).order('spent_on', { ascending: false })
      if (!data?.length) return screen(chat, '💸 لا مصاريف في هذه الفترة.', [[['➕ مصروف جديد', 'f:addExpense']], backRow()])
      const total = data.reduce((s, e: any) => s + e.amount, 0)
      return screen(chat, `💸 <b>المصاريف — ${days === 1 ? 'اليوم' : 'هذا الشهر'}</b>\nالمجموع: <b>${iqd(total)}</b>\n\n` +
        data.slice(0, 25).map((e: any) =>
          `• ${e.expense_categories?.name ?? '—'} — ${iqd(e.amount)}${e.note ? ` (${e.note})` : ''} — ${e.spent_on}`).join('\n'),
        [[['➕ مصروف جديد', 'f:addExpense']], backRow()])
    }
  }
}

async function sendSales(chat: number, from: string, to: string, title: string) {
  const { data, error } = await db.rpc('finance_summary', { p_from: from, p_to: to })
  if (error || !data) return screen(chat, '⚠️ تعذّر التقرير.', [backRow()])
  const net = data.sales_total - data.expenses - data.purchases
  return screen(chat,
    `📊 <b>${title}</b>\n<code>${from} → ${to}</code>\n\n` +
    `🧾 الطلبات: <b>${data.orders_count}</b>\n📦 بضاعة: <b>${iqd(data.sales_goods)}</b>\n` +
    `🚚 توصيل: <b>${iqd(data.sales_delivery)}</b>\n💰 إجمالي المبيعات: <b>${iqd(data.sales_total)}</b>\n` +
    `   ├ نقد: ${iqd(data.sales_cash)}\n   └ آجل: ${iqd(data.sales_debt)}\n\n` +
    `💸 مصاريف: <b>${iqd(data.expenses)}</b>\n📥 مشتريات: <b>${iqd(data.purchases)}</b>\n` +
    `━━━━━━━━━━━━\n${net >= 0 ? '📈' : '📉'} <b>الصافي: ${iqd(net)}</b>\n\n` +
    `💳 ديون مفتوحة: ${iqd(data.debts_open)}` +
    (data.debts_overdue > 0 ? `\n⚠️ متأخرة: <b>${iqd(data.debts_overdue)}</b>` : ''),
    [[['📊 فترة أخرى', 'm:sales']], backRow()])
}

async function listCategories(chat: number, prefix = '') {
  const { data } = await db.from('categories').select('id, name').order('sort_order')
  return screen(chat, prefix + '🏷 <b>الأصناف</b>\n\n' + (data ?? []).map((c) => `• ${c.name}`).join('\n'),
    [[['➕ إضافة صنف', 'f:addCategory']], backRow()])
}

async function listZones(chat: number, prefix = '') {
  const { data } = await db.from('delivery_zones').select('id, name, fee, is_active').order('sort_order')
  return screen(chat, prefix + '🚚 <b>أسعار التوصيل</b>\nاضغط منطقة لتعديل أجرتها:',
    [...(data ?? []).map((z: any) =>
      [[`${z.is_active ? '' : '⏸ '}${z.name} — ${iqd(z.fee)}`, `zone:${z.id}`]] as Row),
      backRow()])
}

async function toggleAgent(chat: number, telegramId: number, admin: boolean) {
  if (!admin) return
  const { data: a } = await db.from('telegram_agents').select('is_active, agent_name').eq('telegram_id', telegramId).maybeSingle()
  if (!a) return screen(chat, '❌ لم أجد المستخدم.', [backRow()])
  await db.from('telegram_agents').update({ is_active: !a.is_active }).eq('telegram_id', telegramId)
  return report(chat, 'agents', undefined, { telegram_id: 0, agent_name: '', role: 'admin' })
}

// -------------------------------------------------------------- مساعدات
function parseQty(text: string): { dozen: number; singles: number } | null {
  const parts = digits(text).trim().split(/[\s،,x×*]+/).map((p) => p.replace(/[^\d]/g, '')).filter(Boolean)
  if (!parts.length) return null
  if (parts.length === 1) return { dozen: 0, singles: Number(parts[0]) }
  return { dozen: Number(parts[0]), singles: Number(parts[1]) }
}

async function findProduct(term: string) {
  const q = term.trim()
  if (!q) return null
  const cols = 'id, code, name, quantity_single'
  const { data: byCode } = await db.from('products').select(cols).eq('barcode', q).maybeSingle()
  if (byCode) return byCode
  // رمز صفحة المنتج القصير يصلح للبحث أيضاً
  const { data: byShort } = await db.from('products').select(cols).eq('code', q.toUpperCase()).maybeSingle()
  if (byShort) return byShort
  const { data } = await db.from('products').select(cols).ilike('name', `%${q}%`).limit(1)
  return data?.[0] ?? null
}

/** ينزّل صورة من تيليغرام ويقرأ منها الباركود */
async function readBarcodePhoto(fileId: string): Promise<string | null> {
  const bytes = await downloadFile(fileId)
  if (!bytes) return null
  try { return decodeBarcode(bytes) } catch { return null }
}

async function downloadFile(fileId: string): Promise<Uint8Array | null> {
  try {
    const info = await tg('getFile', { file_id: fileId })
    const path = info?.result?.file_path
    if (!path) return null
    const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`)
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

async function uploadPhoto(fileId: string, productId: string): Promise<string | null> {
  const bytes = await downloadFile(fileId)
  if (!bytes) return null
  const { error } = await db.storage.from('product-images')
    .upload(`${productId}.jpg`, bytes, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
  if (error) return null
  const { publicUrl } = db.storage.from('product-images').getPublicUrl(`${productId}.jpg`).data
  return `${publicUrl}?v=${Date.now()}`
}

async function quickSearch(chat: number, term: string, admin: boolean) {
  const p = await findProduct(term)
  if (!p) return screen(chat, '❌ لم أجد منتجاً مطابقاً.', [[['➕ إضافة منتج', 'f:addProduct']], backRow()])
  let extra = ''
  if (admin) {
    const { data: pr } = await db.from('product_prices').select('*').eq('product_id', p.id).maybeSingle()
    extra = `\n🏷 المفرد: ${iqd(pr?.price_retail ?? 0)}\n📦 الجملة: ${iqd(pr?.price_wholesale ?? 0)} للقطعة`
  }
  return screen(chat,
    `📦 <b>${p.name}</b>\n📊 الرصيد: <b>${p.quantity_single}</b> قطعة${extra}` +
    (STORE_URL ? `\n\n🔗 ${STORE_URL}/p/${p.code}` : ''),
    [
      STORE_URL ? [['🔗 صفحة المنتج', `${STORE_URL}/p/${p.code}`]] : [],
      [['📥 إضافة كمية', 'f:addStock']],
      admin ? [['💵 تسعير', 'f:setPrice']] : [],
      backRow(),
    ])
}
