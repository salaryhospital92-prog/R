// =====================================================================
// أسواق الرفاعي — بوت تيليغرام للتحكم الكامل بالمتجر
//
// الأمان طبقتان:
//   1) ترويسة X-Telegram-Bot-Api-Secret-Token تطابق السر المخزَّن.
//   2) telegram_id مسجَّل ومفعَّل في جدول telegram_agents.
// أي فشل يُرَدّ عليه بـ 200 صامتة حتى لا نكشف شيئاً للمهاجم.
//
// الصلاحيات: وكيل بدور data_entry يرى المخزون والمنتجات فقط.
// المال (أسعار، مبيعات، ديون، مصاريف، مشتريات) للمدير وحده.
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const API = `https://api.telegram.org/bot${BOT_TOKEN}`

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

// ---------------------------------------------------------------- أدوات
const iqd = (n: number | string) =>
  `${new Intl.NumberFormat('en-US').format(Math.round(Number(n) || 0))} د.ع`

const num = (s: string) => {
  const cleaned = String(s ?? '').replace(/[^\d]/g, '')
  return cleaned === '' ? NaN : Number(cleaned)
}

const today = () => new Date().toISOString().slice(0, 10)
const shift = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
const monthStart = () => today().slice(0, 8) + '01'

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim())

async function tg(method: string, payload: unknown) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return r.json().catch(() => ({}))
}

const send = (chat: number, text: string, keyboard?: unknown) =>
  tg('sendMessage', {
    chat_id: chat, text, parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  })

const rows = (...r: Array<Array<[string, string]>>) =>
  r.map((row) => row.map(([text, data]) => ({ text, callback_data: data })))

// ------------------------------------------------------- حالة المحادثة
type State = { flow?: string; step?: string; data?: Record<string, unknown> }

async function getState(chat: number): Promise<State> {
  const { data } = await db.from('telegram_sessions').select('state').eq('chat_id', chat).maybeSingle()
  return (data?.state as State) ?? {}
}
const setState = (chat: number, state: State) =>
  db.from('telegram_sessions').upsert({ chat_id: chat, state, updated_at: new Date().toISOString() })
const clearState = (chat: number) => setState(chat, {})

// ------------------------------------------------------------- القوائم
function mainMenu(admin: boolean) {
  const menu: Array<Array<[string, string]>> = [
    [['📦 المخزون', 'm:stock'], ['🏷 الأصناف', 'm:cats']],
  ]
  if (admin) {
    menu.push(
      [['💵 الأسعار', 'm:prices'], ['🧾 فاتورة بيع', 'm:invoice']],
      [['📊 المبيعات', 'm:sales'], ['📥 المشتريات', 'm:purch']],
      [['💳 الديون', 'm:debts'], ['💸 المصاريف', 'm:exp']],
      [['🚚 أسعار التوصيل', 'm:zones']],
    )
  }
  return rows(...menu)
}

const backRow = (): Array<[string, string]> => [['⬅️ القائمة', 'm:main']]

// ==================================================== المعالج الرئيسي
Deno.serve(async (req) => {
  // الطبقة الأولى: سر الويبهوك
  if (SECRET && req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('ok', { status: 200 })
  }

  let update: any
  try { update = await req.json() } catch { return new Response('ok') }

  const msg = update.message ?? update.edited_message
  const cb = update.callback_query
  const from = msg?.from ?? cb?.from
  const chat = msg?.chat?.id ?? cb?.message?.chat?.id
  if (!from || !chat) return new Response('ok')

  try {
    const agent = await authorize(from, chat)
    if (!agent) return new Response('ok')       // غير مصرّح — صمت تام

    if (cb) {
      await tg('answerCallbackQuery', { callback_query_id: cb.id })
      await onAction(chat, cb.data ?? '', agent)
    } else if (msg) {
      await onMessage(chat, msg, agent)
    }
  } catch (e) {
    console.error('bot error', e)
    await send(chat, '⚠️ صار خطأ غير متوقع. اكتب /start للبداية من جديد.').catch(() => {})
  }
  return new Response('ok')
})

// ---------------------------------------------------- الطبقة الثانية
type Agent = { telegram_id: number; agent_name: string; role: string }

async function authorize(from: any, chat: number): Promise<Agent | null> {
  const { data: agent } = await db
    .from('telegram_agents')
    .select('telegram_id, agent_name, role, is_active')
    .eq('telegram_id', from.id)
    .maybeSingle()

  if (agent?.is_active) return agent as Agent
  if (agent) return null                        // موقوف

  // تسجيل أول مستخدم كمدير (مرة واحدة فقط، قبل وجود أي وكيل)
  const { count } = await db.from('telegram_agents').select('telegram_id', { count: 'exact', head: true })
  if ((count ?? 0) > 0) return null

  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'المدير'
  await db.from('telegram_agents').insert({
    telegram_id: from.id, agent_name: name, role: 'admin', is_active: true,
  })
  await db.from('app_settings').upsert([
    { key: 'telegram_chat_id', value: String(chat), updated_at: new Date().toISOString() },
  ])
  await send(chat, `✅ تم تسجيلك مديراً للبوت يا <b>${name}</b>.\nإشعارات الطلبات ستصلك هنا.`)
  return { telegram_id: from.id, agent_name: name, role: 'admin' }
}

// ======================================================= الرسائل النصية
async function onMessage(chat: number, msg: any, agent: Agent) {
  const text: string = (msg.text ?? msg.caption ?? '').trim()
  const admin = agent.role === 'admin'

  if (text === '/start' || text === '/menu' || text === 'القائمة') {
    await clearState(chat)
    return send(chat,
      `👋 أهلاً <b>${agent.agent_name}</b> — لوحة تحكم <b>أسواق الرفاعي</b>.\nاختر ما تريد:`,
      mainMenu(admin))
  }
  if (text === '/cancel' || text === 'إلغاء') {
    await clearState(chat)
    return send(chat, 'أُلغيت العملية.', mainMenu(admin))
  }

  const st = await getState(chat)
  if (!st.flow) {
    // بحث سريع بالباركود أو الاسم
    if (text) return quickSearch(chat, text, admin)
    return send(chat, 'اختر من القائمة:', mainMenu(admin))
  }

  const photo = msg.photo?.at(-1)?.file_id ?? null
  return runFlow(chat, st, { text, photo }, agent)
}

// ==================================================== أزرار القوائم
async function onAction(chat: number, action: string, agent: Agent) {
  const admin = agent.role === 'admin'
  const [ns, key, arg] = action.split(':')

  const needAdmin = () => {
    if (admin) return false
    send(chat, '🔒 هذا القسم للمدير فقط.')
    return true
  }

  if (ns === 'm') {
    if (['prices', 'sales', 'purch', 'debts', 'exp', 'zones', 'invoice'].includes(key) && needAdmin()) return
    await clearState(chat)
    switch (key) {
      case 'main': return send(chat, 'القائمة الرئيسية:', mainMenu(admin))
      case 'stock': return send(chat, '📦 المخزون:', rows(
        [['➕ منتج جديد', 'f:addProduct'], ['📥 إضافة كمية', 'f:addStock']],
        [['📋 المخزون الحالي', 'r:stock'], ['⚠️ النواقص', 'r:low']],
        backRow()))
      case 'cats': return listCategories(chat)
      case 'prices': return startFlow(chat, 'setPrice')
      case 'invoice': return startFlow(chat, 'invoice')
      case 'sales': return send(chat, '📊 المبيعات:', rows(
        [['اليوم', 'r:sales:today'], ['أمس', 'r:sales:yesterday']],
        [['هذا الشهر', 'r:sales:month'], ['آخر 7 أيام', 'r:sales:week']],
        [['📅 بتاريخ محدد', 'f:salesDate'], ['🏆 الأكثر مبيعاً', 'r:top']],
        backRow()))
      case 'purch': return send(chat, '📥 المشتريات:', rows(
        [['🧾 فاتورة شراء جديدة', 'f:purchase']],
        [['⚠️ فاتورة نواقص', 'r:lowInvoice']],
        [['📋 آخر الفواتير', 'r:purchases']],
        backRow()))
      case 'debts': return send(chat, '💳 دفتر الديون:', rows(
        [['➕ دَين جديد', 'f:addDebt'], ['💵 تسديد', 'f:payDebt']],
        [['📋 الديون المفتوحة', 'r:debts']],
        [['يومي', 'r:debtRep:1'], ['أسبوعي', 'r:debtRep:7']],
        [['شهري', 'r:debtRep:30'], ['سنوي', 'r:debtRep:365']],
        backRow()))
      case 'exp': return send(chat, '💸 المصاريف:', rows(
        [['➕ مصروف جديد', 'f:addExpense']],
        [['اليوم', 'r:exp:1'], ['هذا الشهر', 'r:exp:30']],
        backRow()))
      case 'zones': return listZones(chat)
    }
  }

  if (ns === 'f') {
    if (!['addProduct', 'addStock', 'addCategory'].includes(key) && needAdmin()) return
    return startFlow(chat, key, arg)
  }

  if (ns === 'r') {
    if (!['stock', 'low'].includes(key) && needAdmin()) return
    return report(chat, key, arg, admin)
  }

  if (ns === 'pick') {          // اختيار عنصر داخل معالج جارٍ
    const st = await getState(chat)
    if (!st.flow) return send(chat, 'انتهت الجلسة. اكتب /start.', mainMenu(admin))
    return runFlow(chat, st, { pick: arg ?? key }, agent)
  }

  if (ns === 'zone') {          // تعديل أجرة منطقة
    if (needAdmin()) return
    return startFlow(chat, 'setZoneFee', key)
  }
}

// ==================================================== بدء المعالجات
async function startFlow(chat: number, flow: string, arg?: string) {
  switch (flow) {
    case 'addProduct':
      await setState(chat, { flow, step: 'barcode', data: {} })
      return send(chat, '➕ <b>منتج جديد</b>\n\n1️⃣ أرسل <b>الباركود</b> (اكتبه أو الصقه).\nأو اضغط تخطي إن لم يكن له باركود.',
        rows([['تخطي', 'pick:skip']], [['إلغاء', 'm:main']]))

    case 'addStock':
      await setState(chat, { flow, step: 'find', data: {} })
      return send(chat, '📥 <b>إضافة كمية</b>\n\nأرسل <b>باركود</b> المنتج أو جزءاً من اسمه.',
        rows([['إلغاء', 'm:main']]))

    case 'addCategory':
      await setState(chat, { flow, step: 'name', data: {} })
      return send(chat, '🏷 أرسل <b>اسم الصنف</b> الجديد.', rows([['إلغاء', 'm:main']]))

    case 'setPrice':
      await setState(chat, { flow, step: 'find', data: {} })
      return send(chat, '💵 <b>تسعير منتج</b>\n\nأرسل باركود المنتج أو جزءاً من اسمه.',
        rows([['إلغاء', 'm:main']]))

    case 'salesDate':
      await setState(chat, { flow, step: 'date', data: {} })
      return send(chat, '📅 أرسل التاريخ بصيغة <code>YYYY-MM-DD</code>\nمثال: <code>2026-08-26</code>',
        rows([['إلغاء', 'm:main']]))

    case 'addExpense': {
      const { data: cats } = await db.from('expense_categories').select('id, name').order('sort_order')
      await setState(chat, { flow, step: 'category', data: {} })
      return send(chat, '💸 <b>مصروف جديد</b>\n\nاختر النوع:',
        rows(...chunk((cats ?? []).map((c) => [c.name, `pick:${c.id}`] as [string, string]), 2),
          [['إلغاء', 'm:main']]))
    }

    case 'addDebt':
      await setState(chat, { flow, step: 'kind', data: {} })
      return send(chat, '💳 <b>دَين جديد</b>\n\nنوع الدَين:', rows(
        [['⬅️ لنا (على زبون)', 'pick:receivable']],
        [['➡️ علينا (لمورّد)', 'pick:payable']],
        [['إلغاء', 'm:main']]))

    case 'payDebt': {
      const { data: open } = await db.from('debts_view')
        .select('id, party_name, remaining, kind').is('settled_at', null).order('created_at').limit(20)
      if (!open?.length) return send(chat, '✅ لا توجد ديون مفتوحة.', mainMenu(true))
      await setState(chat, { flow, step: 'pickDebt', data: {} })
      return send(chat, '💵 اختر الدَين للتسديد:', rows(
        ...open.map((d) => [[`${d.kind === 'receivable' ? '⬅️' : '➡️'} ${d.party_name} — ${iqd(d.remaining)}`, `pick:${d.id}`]] as Array<[string, string]>),
        [['إلغاء', 'm:main']]))
    }

    case 'purchase':
      await setState(chat, { flow, step: 'supplier', data: { items: [] } })
      return send(chat, '📥 <b>فاتورة شراء</b>\n\nأرسل <b>اسم المورّد</b>.', rows([['إلغاء', 'm:main']]))

    case 'invoice':
      await setState(chat, { flow, step: 'find', data: { items: [] } })
      return send(chat, '🧾 <b>فاتورة بيع</b>\n\nأرسل باركود المنتج أو جزءاً من اسمه لإضافته.',
        rows([['إلغاء', 'm:main']]))

    case 'setZoneFee':
      await setState(chat, { flow, step: 'fee', data: { zoneId: arg } })
      return send(chat, '🚚 أرسل الأجرة الجديدة بالدينار (أرقام فقط).', rows([['إلغاء', 'm:main']]))
  }
}

const chunk = <T,>(arr: T[], size: number): T[][] =>
  arr.reduce<T[][]>((acc, x, i) => (i % size ? acc[acc.length - 1].push(x) : acc.push([x]), acc), [])

// ==================================================== تنفيذ المعالجات
type Input = { text?: string; photo?: string | null; pick?: string }

async function runFlow(chat: number, st: State, input: Input, agent: Agent) {
  const d = (st.data ?? {}) as Record<string, any>
  const t = (input.text ?? '').trim()
  const admin = agent.role === 'admin'
  const save = (step: string, extra: Record<string, unknown> = {}) =>
    setState(chat, { flow: st.flow, step, data: { ...d, ...extra } })

  switch (st.flow) {
    // ---------------------------------------------------- منتج جديد
    case 'addProduct': {
      if (st.step === 'barcode') {
        d.barcode = input.pick === 'skip' ? null : t || null
        if (d.barcode) {
          const { data: dup } = await db.from('products').select('id, name').eq('barcode', d.barcode).maybeSingle()
          if (dup) {
            await clearState(chat)
            return send(chat, `⚠️ الباركود مسجَّل مسبقاً للمنتج: <b>${dup.name}</b>.\nاستعمل «إضافة كمية».`, mainMenu(admin))
          }
        }
        await save('name', { barcode: d.barcode })
        return send(chat, '2️⃣ أرسل <b>اسم المنتج</b>.')
      }

      if (st.step === 'name') {
        if (!t) return send(chat, 'الاسم مطلوب. أرسل اسم المنتج.')
        const { data: cats } = await db.from('categories').select('id, name').order('sort_order')
        await save('category', { name: t })
        return send(chat, '3️⃣ اختر <b>الصنف</b>:',
          rows(...chunk((cats ?? []).map((c) => [c.name, `pick:${c.id}`] as [string, string]), 2)))
      }

      if (st.step === 'category') {
        if (!input.pick) return send(chat, 'اختر الصنف من الأزرار.')
        await save('photo', { categoryId: Number(input.pick) })
        return send(chat, '4️⃣ أرسل <b>صورة المنتج</b> الآن، أو اضغط تخطي.',
          rows([['تخطي', 'pick:skip']]))
      }

      if (st.step === 'photo') {
        if (input.photo) d.photo = input.photo
        else if (input.pick !== 'skip' && !input.photo) return send(chat, 'أرسل صورة أو اضغط تخطي.')
        await save('qty', { photo: d.photo ?? null })
        return send(chat, '5️⃣ أرسل الكمية بصيغة <b>درزن مفرد</b>\nمثال: <code>2 3</code> = 27 قطعة\nأو أرسل رقماً واحداً للقطع.')
      }

      if (st.step === 'qty') {
        const q = parseQty(t)
        if (!q) return send(chat, 'صيغة غير مفهومة. أرسل مثلاً: <code>2 3</code> أو <code>15</code>.')
        if (!admin) return finishProduct(chat, { ...d, ...q }, agent, null, null)
        await save('retail', q)
        return send(chat, '6️⃣ أرسل <b>سعر المفرد</b> بالدينار (أو 0 ليكون «السعر عند الطلب»).')
      }

      if (st.step === 'retail') {
        const v = num(t)
        if (isNaN(v)) return send(chat, 'أرسل رقماً.')
        await save('wholesale', { retail: v })
        return send(chat, '7️⃣ أرسل <b>سعر الدرزن</b> بالدينار (أو 0).\nسيُقسَّم على 12 لسعر القطعة بالجملة.')
      }

      if (st.step === 'wholesale') {
        const v = num(t)
        if (isNaN(v)) return send(chat, 'أرسل رقماً.')
        return finishProduct(chat, d, agent, d.retail, Math.round(v / 12))
      }
      break
    }

    // --------------------------------------------------- إضافة كمية
    case 'addStock': {
      if (st.step === 'find') {
        const p = await findProduct(t)
        if (!p) return send(chat, '❌ لم أجد منتجاً مطابقاً. جرّب اسماً أوضح أو الباركود.')
        await save('qty', { productId: p.id, productName: p.name, current: p.quantity_single })
        return send(chat, `📦 <b>${p.name}</b>\nالرصيد الحالي: <b>${p.quantity_single}</b> قطعة\n\nأرسل الكمية المضافة بصيغة <b>درزن مفرد</b> (مثال <code>2 3</code>) أو رقماً واحداً.`)
      }
      if (st.step === 'qty') {
        const q = parseQty(t)
        if (!q) return send(chat, 'صيغة غير مفهومة. مثال: <code>2 3</code> أو <code>15</code>.')
        const { error } = await db.from('stock_movements').insert({
          product_id: d.productId, type: 'stock_in',
          dozen_qty: q.dozen, singles_qty: q.singles,
          source: 'telegram_bot', note: `عبر البوت — ${agent.agent_name}`,
        })
        await clearState(chat)
        if (error) return send(chat, '⚠️ تعذّر الحفظ: ' + error.message, mainMenu(admin))
        const total = q.dozen * 12 + q.singles
        return send(chat,
          `✅ أُضيفت <b>${total}</b> قطعة إلى <b>${d.productName}</b>\nالرصيد الجديد: <b>${d.current + total}</b> قطعة`,
          mainMenu(admin))
      }
      break
    }

    // ---------------------------------------------------- صنف جديد
    case 'addCategory': {
      if (!t) return send(chat, 'أرسل اسم الصنف.')
      const { error } = await db.from('categories').insert({ name: t, sort_order: 99 })
      await clearState(chat)
      return send(chat, error ? '⚠️ الصنف موجود مسبقاً أو حدث خطأ.' : `✅ أُضيف الصنف <b>${t}</b>.`, mainMenu(admin))
    }

    // ------------------------------------------------------- تسعير
    case 'setPrice': {
      if (st.step === 'find') {
        const p = await findProduct(t)
        if (!p) return send(chat, '❌ لم أجد منتجاً مطابقاً.')
        const { data: pr } = await db.from('product_prices').select('*').eq('product_id', p.id).maybeSingle()
        await save('retail', { productId: p.id, productName: p.name })
        return send(chat,
          `💵 <b>${p.name}</b>\nالمفرد الحالي: ${iqd(pr?.price_retail ?? 0)}\nالجملة الحالية: ${iqd(pr?.price_wholesale ?? 0)} للقطعة\n\nأرسل <b>سعر المفرد</b> الجديد.`)
      }
      if (st.step === 'retail') {
        const v = num(t)
        if (isNaN(v)) return send(chat, 'أرسل رقماً.')
        await save('wholesale', { retail: v })
        return send(chat, 'أرسل <b>سعر الدرزن</b> (سيُقسَّم على 12).')
      }
      if (st.step === 'wholesale') {
        const v = num(t)
        if (isNaN(v)) return send(chat, 'أرسل رقماً.')
        const wholesale = Math.round(v / 12)
        const { error } = await db.from('product_prices').upsert({
          product_id: d.productId, price_retail: d.retail, price_wholesale: wholesale,
          updated_at: new Date().toISOString(),
        })
        await clearState(chat)
        return send(chat, error ? '⚠️ تعذّر الحفظ.'
          : `✅ <b>${d.productName}</b>\nالمفرد: ${iqd(d.retail)}\nالجملة: ${iqd(wholesale)} للقطعة (${iqd(v)} للدرزن)`,
          mainMenu(admin))
      }
      break
    }

    // ------------------------------------------------ مبيعات بتاريخ
    case 'salesDate': {
      if (!isDate(t)) return send(chat, 'الصيغة: <code>YYYY-MM-DD</code>')
      await clearState(chat)
      return sendSales(chat, t.trim(), t.trim(), `مبيعات ${t.trim()}`)
    }

    // ------------------------------------------------------- مصروف
    case 'addExpense': {
      if (st.step === 'category') {
        if (!input.pick) return send(chat, 'اختر النوع من الأزرار.')
        await save('amount', { categoryId: Number(input.pick) })
        return send(chat, 'أرسل <b>المبلغ</b> بالدينار.')
      }
      if (st.step === 'amount') {
        const v = num(t)
        if (isNaN(v) || v <= 0) return send(chat, 'أرسل مبلغاً صحيحاً.')
        await save('note', { amount: v })
        return send(chat, 'أرسل <b>ملاحظة</b> (أو اضغط تخطي).', rows([['تخطي', 'pick:skip']]))
      }
      if (st.step === 'note') {
        const note = input.pick === 'skip' ? null : t || null
        const { error } = await db.from('expenses').insert({
          category_id: d.categoryId, amount: d.amount, note, spent_on: today(),
        })
        await clearState(chat)
        return send(chat, error ? '⚠️ تعذّر الحفظ.' : `✅ سُجّل مصروف ${iqd(d.amount)}.`, mainMenu(admin))
      }
      break
    }

    // -------------------------------------------------------- ديون
    case 'addDebt': {
      if (st.step === 'kind') {
        if (!input.pick) return send(chat, 'اختر النوع.')
        await save('party', { kind: input.pick })
        return send(chat, 'أرسل <b>اسم الطرف</b> (الزبون أو المورّد).')
      }
      if (st.step === 'party') {
        if (!t) return send(chat, 'الاسم مطلوب.')
        await save('amount', { party: t })
        return send(chat, 'أرسل <b>المبلغ</b> بالدينار.')
      }
      if (st.step === 'amount') {
        const v = num(t)
        if (isNaN(v) || v <= 0) return send(chat, 'أرسل مبلغاً صحيحاً.')
        await save('due', { amount: v })
        return send(chat, 'أرسل <b>تاريخ الاستحقاق</b> <code>YYYY-MM-DD</code> أو اضغط تخطي.',
          rows([['تخطي', 'pick:skip']]))
      }
      if (st.step === 'due') {
        const due = input.pick === 'skip' ? null : (isDate(t) ? t.trim() : null)
        if (input.pick !== 'skip' && !due) return send(chat, 'الصيغة: <code>YYYY-MM-DD</code> أو اضغط تخطي.')
        const { error } = await db.from('debts').insert({
          kind: d.kind, party_name: d.party, amount: d.amount, due_on: due,
          note: `عبر البوت — ${agent.agent_name}`,
        })
        await clearState(chat)
        return send(chat, error ? '⚠️ تعذّر الحفظ.'
          : `✅ سُجّل دَين ${d.kind === 'receivable' ? 'لنا على' : 'علينا لـ'} <b>${d.party}</b> بمبلغ ${iqd(d.amount)}${due ? `\nالاستحقاق: ${due}` : ''}`,
          mainMenu(admin))
      }
      break
    }

    case 'payDebt': {
      if (st.step === 'pickDebt') {
        if (!input.pick) return send(chat, 'اختر الدَين من الأزرار.')
        const { data: debt } = await db.from('debts_view').select('*').eq('id', input.pick).maybeSingle()
        if (!debt) return send(chat, '❌ لم أجد الدَين.')
        await save('amount', { debtId: debt.id, remaining: debt.remaining, party: debt.party_name })
        return send(chat, `💳 <b>${debt.party_name}</b>\nالمتبقي: <b>${iqd(debt.remaining)}</b>\n\nأرسل <b>المبلغ المسدَّد</b>.`)
      }
      if (st.step === 'amount') {
        const v = num(t)
        if (isNaN(v) || v <= 0) return send(chat, 'أرسل مبلغاً صحيحاً.')
        const { error } = await db.from('debt_payments').insert({
          debt_id: d.debtId, amount: v, paid_on: today(), note: `عبر البوت — ${agent.agent_name}`,
        })
        await clearState(chat)
        if (error) return send(chat, '⚠️ تعذّر الحفظ.', mainMenu(admin))
        const left = Math.max(0, d.remaining - v)
        return send(chat,
          `✅ سُدّد ${iqd(v)} من دَين <b>${d.party}</b>.\n${left > 0 ? `المتبقي: <b>${iqd(left)}</b>` : '🎉 سُدّد الدَين بالكامل.'}`,
          mainMenu(admin))
      }
      break
    }

    // --------------------------------------------------- فاتورة شراء
    case 'purchase': {
      if (st.step === 'supplier') {
        if (!t) return send(chat, 'أرسل اسم المورّد.')
        await save('item', { supplier: t })
        return send(chat, `🧾 المورّد: <b>${t}</b>\n\nأرسل باركود المنتج أو جزءاً من اسمه لإضافته للفاتورة.`,
          rows([['✅ إنهاء الفاتورة', 'pick:done']]))
      }
      if (st.step === 'item') {
        if (input.pick === 'done') return finishPurchase(chat, d, admin)
        const p = await findProduct(t)
        if (!p) return send(chat, '❌ لم أجد منتجاً مطابقاً.')
        await save('itemQty', { cur: { id: p.id, name: p.name } })
        return send(chat, `📦 <b>${p.name}</b>\nأرسل الكمية <b>درزن مفرد</b> (مثال <code>3 0</code>).`)
      }
      if (st.step === 'itemQty') {
        const q = parseQty(t)
        if (!q) return send(chat, 'مثال: <code>3 0</code> أو <code>36</code>.')
        await save('itemCost', { curQty: q })
        return send(chat, 'أرسل <b>كلفة القطعة</b> بالدينار (كلفة الشراء).')
      }
      if (st.step === 'itemCost') {
        const v = num(t)
        if (isNaN(v)) return send(chat, 'أرسل رقماً.')
        const items = [...(d.items ?? []), { ...d.cur, ...d.curQty, cost: v }]
        await save('item', { items, cur: null, curQty: null })
        const total = items.reduce((s: number, i: any) => s + (i.dozen * 12 + i.singles) * i.cost, 0)
        return send(chat,
          `✅ أُضيف. عدد البنود: <b>${items.length}</b>\nالمجموع حتى الآن: <b>${iqd(total)}</b>\n\nأرسل منتجاً آخر أو أنهِ الفاتورة.`,
          rows([['✅ إنهاء الفاتورة', 'pick:done']]))
      }
      break
    }

    // --------------------------------------------------- فاتورة بيع
    case 'invoice': {
      if (st.step === 'find') {
        if (input.pick === 'done') {
          if (!(d.items ?? []).length) return send(chat, 'الفاتورة فارغة.')
          await save('customer')
          return send(chat, 'أرسل <b>اسم الزبون</b>.')
        }
        const p = await findProduct(t)
        if (!p) return send(chat, '❌ لم أجد منتجاً مطابقاً.')
        const { data: pr } = await db.from('product_prices').select('price_retail').eq('product_id', p.id).maybeSingle()
        await save('itemQty', { cur: { id: p.id, name: p.name, price: pr?.price_retail ?? 0, stock: p.quantity_single } })
        return send(chat, `🧾 <b>${p.name}</b> — ${iqd(pr?.price_retail ?? 0)} للقطعة\nالمتوفر: ${p.quantity_single}\n\nأرسل <b>عدد القطع</b>.`)
      }
      if (st.step === 'itemQty') {
        const v = num(t)
        if (isNaN(v) || v <= 0) return send(chat, 'أرسل عدداً صحيحاً.')
        if (v > d.cur.stock) return send(chat, `⚠️ المتوفر ${d.cur.stock} قطعة فقط.`)
        const items = [...(d.items ?? []), { ...d.cur, qty: v }]
        const total = items.reduce((s: number, i: any) => s + i.qty * i.price, 0)
        await save('find', { items, cur: null })
        return send(chat, `✅ أُضيف. المجموع: <b>${iqd(total)}</b>\n\nأرسل منتجاً آخر أو أنهِ الفاتورة.`,
          rows([['✅ إنهاء الفاتورة', 'pick:done']]))
      }
      if (st.step === 'customer') {
        if (!t) return send(chat, 'أرسل اسم الزبون.')
        await save('payment', { customer: t })
        return send(chat, 'طريقة الدفع:', rows([['💵 نقد', 'pick:cash'], ['📝 آجل (دَين)', 'pick:debt']]))
      }
      if (st.step === 'payment') {
        if (!input.pick) return send(chat, 'اختر طريقة الدفع.')
        return finishInvoice(chat, d, input.pick, agent)
      }
      break
    }

    // ------------------------------------------------- أجرة التوصيل
    case 'setZoneFee': {
      const v = num(t)
      if (isNaN(v)) return send(chat, 'أرسل رقماً.')
      const { error } = await db.from('delivery_zones').update({ fee: v }).eq('id', Number(d.zoneId))
      await clearState(chat)
      if (error) return send(chat, '⚠️ تعذّر الحفظ.', mainMenu(admin))
      await send(chat, `✅ صارت الأجرة ${iqd(v)}.`)
      return listZones(chat)
    }
  }
}

// ------------------------------------------------------------ إنهاءات
async function finishProduct(chat: number, d: any, agent: Agent, retail: number | null, wholesale: number | null) {
  const { data: product, error } = await db.from('products')
    .insert({ barcode: d.barcode, name: d.name, category_id: d.categoryId })
    .select('id').single()

  if (error || !product) {
    await clearState(chat)
    return send(chat, '⚠️ تعذّرت الإضافة: ' + (error?.message ?? ''), mainMenu(agent.role === 'admin'))
  }

  if (d.photo) {
    const url = await uploadPhoto(d.photo, product.id)
    if (url) await db.from('products').update({ image_url: url }).eq('id', product.id)
  }

  const total = (d.dozen ?? 0) * 12 + (d.singles ?? 0)
  if (total > 0) {
    await db.from('stock_movements').insert({
      product_id: product.id, type: 'stock_in',
      dozen_qty: d.dozen ?? 0, singles_qty: d.singles ?? 0,
      source: 'telegram_bot', note: `عبر البوت — ${agent.agent_name}`,
    })
  }
  if (retail !== null || wholesale !== null) {
    await db.from('product_prices').upsert({
      product_id: product.id,
      price_retail: retail ?? 0, price_wholesale: wholesale ?? 0,
      updated_at: new Date().toISOString(),
    })
  }

  await clearState(chat)
  return send(chat,
    `✅ <b>${d.name}</b> أُضيف للمتجر.\n` +
    `الباركود: ${d.barcode ?? '—'}\n` +
    `الكمية: <b>${total}</b> قطعة\n` +
    (retail !== null ? `المفرد: ${iqd(retail)}\nالجملة: ${iqd(wholesale ?? 0)} للقطعة\n` : '') +
    (d.photo ? '📷 مع الصورة' : ''),
    mainMenu(agent.role === 'admin'))
}

async function finishPurchase(chat: number, d: any, admin: boolean) {
  const items = d.items ?? []
  if (!items.length) return send(chat, 'الفاتورة فارغة — أضف بنداً أولاً.')

  const { data: purchase, error } = await db.from('purchases')
    .insert({ supplier_name: d.supplier, status: 'draft' }).select('id, purchase_number').single()
  if (error || !purchase) return send(chat, '⚠️ تعذّر الحفظ.', mainMenu(admin))

  await db.from('purchase_items').insert(items.map((i: any) => ({
    purchase_id: purchase.id, product_id: i.id, name: i.name,
    dozen_qty: i.dozen, singles_qty: i.singles, unit_cost: i.cost,
  })))
  // تأكيد الاستلام يُدخل البضاعة للمخزون عبر trigger في قاعدة البيانات
  await db.from('purchases').update({ status: 'received' }).eq('id', purchase.id)

  const total = items.reduce((s: number, i: any) => s + (i.dozen * 12 + i.singles) * i.cost, 0)
  const lines = items.map((i: any, n: number) =>
    `${n + 1}. ${i.name} — ${i.dozen * 12 + i.singles} قطعة × ${iqd(i.cost)} = ${iqd((i.dozen * 12 + i.singles) * i.cost)}`).join('\n')

  await clearState(chat)
  return send(chat,
    `✅ <b>فاتورة شراء #${purchase.purchase_number}</b>\nالمورّد: ${d.supplier}\n\n${lines}\n\n💰 المجموع: <b>${iqd(total)}</b>\n📦 أُضيفت الكميات للمخزون.`,
    mainMenu(admin))
}

async function finishInvoice(chat: number, d: any, payment: string, agent: Agent) {
  const { data: zone } = await db.from('delivery_zones').select('id').eq('fee', 0).order('sort_order').limit(1).maybeSingle()
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

  if (error || !order) return send(chat, '⚠️ تعذّر إصدار الفاتورة: ' + (error?.message ?? ''), mainMenu(true))

  // خصم المخزون بنفس قاعدة المتجر: عبر stock_movements
  for (const i of items) {
    await db.from('stock_movements').insert({
      product_id: i.id, type: 'sale', dozen_qty: 0, singles_qty: -i.qty,
      source: 'pos', order_id: order.id, note: `فاتورة #${order.order_number}`,
    })
  }

  const lines = items.map((i: any, n: number) =>
    `${n + 1}. ${i.name} — ${i.qty} × ${iqd(i.price)} = ${iqd(i.qty * i.price)}`).join('\n')

  await clearState(chat)
  void zone
  return send(chat,
    `🧾 <b>فاتورة #${order.order_number}</b>\n` +
    `أسواق الرفاعي — الرمادي، شارع السينما\n` +
    `الزبون: ${d.customer}\n` +
    `الدفع: ${payment === 'debt' ? '📝 آجل (سُجّل ديناً)' : '💵 نقد'}\n\n${lines}\n\n` +
    `💰 <b>المجموع: ${iqd(subtotal)}</b>\n📦 خُصمت الكميات من المخزون.`,
    mainMenu(agent.role === 'admin'))
}

// ------------------------------------------------------------- تقارير
async function report(chat: number, key: string, arg: string | undefined, admin: boolean) {
  switch (key) {
    case 'sales': {
      if (arg === 'today') return sendSales(chat, today(), today(), 'مبيعات اليوم')
      if (arg === 'yesterday') return sendSales(chat, shift(1), shift(1), 'مبيعات أمس')
      if (arg === 'week') return sendSales(chat, shift(6), today(), 'مبيعات آخر 7 أيام')
      return sendSales(chat, monthStart(), today(), 'مبيعات هذا الشهر')
    }

    case 'top': {
      const { data } = await db.rpc('top_products', { p_from: monthStart(), p_to: today(), p_limit: 10 })
      if (!data?.length) return send(chat, 'لا مبيعات هذا الشهر.', rows(backRow()))
      return send(chat, '🏆 <b>الأكثر مبيعاً هذا الشهر</b>\n\n' +
        data.map((r: any, i: number) => `${i + 1}. ${r.name} — ${r.qty} قطعة (${iqd(r.revenue)})`).join('\n'),
        rows(backRow()))
    }

    case 'stock': {
      const { data } = await db.from('products')
        .select('name, quantity_single, categories(name)').eq('is_active', true)
        .order('quantity_single', { ascending: false }).limit(40)
      const total = (data ?? []).reduce((s, p: any) => s + p.quantity_single, 0)
      return send(chat, `📋 <b>المخزون الحالي</b> (أعلى 40)\nالإجمالي: <b>${total}</b> قطعة\n\n` +
        (data ?? []).map((p: any) => `• ${p.name} — <b>${p.quantity_single}</b>`).join('\n'),
        rows(backRow()))
    }

    case 'low': {
      const { data } = await db.rpc('low_stock', { p_threshold: 12 })
      if (!data?.length) return send(chat, '✅ لا نواقص — المخزون بخير.', rows(backRow()))
      return send(chat, '⚠️ <b>نواقص المخزون</b> (درزن أو أقل)\n\n' +
        data.map((p: any) => `• ${p.name} — <b>${p.quantity_single}</b> قطعة`).join('\n'),
        rows(backRow()))
    }

    case 'lowInvoice': {
      const { data } = await db.rpc('low_stock', { p_threshold: 12 })
      if (!data?.length) return send(chat, '✅ لا نواقص تستدعي شراء.', rows(backRow()))
      const lines = data.map((p: any, i: number) =>
        `${i + 1}. ${p.name} — المتوفر ${p.quantity_single} — المقترح ${Math.max(1, Math.ceil((24 - p.quantity_single) / 12))} درزن`).join('\n')
      return send(chat, `🧾 <b>قائمة مشتريات مقترحة</b>\nالهدف: رفع كل صنف إلى درزنين.\n\n${lines}\n\nأنشئ فاتورة شراء لإدخالها.`,
        rows([['🧾 فاتورة شراء جديدة', 'f:purchase']], backRow()))
    }

    case 'purchases': {
      const { data } = await db.from('purchases')
        .select('purchase_number, supplier_name, total_amount, status, created_at')
        .order('created_at', { ascending: false }).limit(10)
      if (!data?.length) return send(chat, 'لا فواتير شراء بعد.', rows(backRow()))
      return send(chat, '📥 <b>آخر فواتير الشراء</b>\n\n' + data.map((p: any) =>
        `#${p.purchase_number} — ${p.supplier_name ?? '—'} — ${iqd(p.total_amount)} — ${p.status === 'received' ? '✅ مستلمة' : p.status}`).join('\n'),
        rows(backRow()))
    }

    case 'debts': {
      const { data } = await db.from('debts_view').select('*').is('settled_at', null).order('due_on', { nullsFirst: false }).limit(30)
      if (!data?.length) return send(chat, '✅ لا ديون مفتوحة.', rows(backRow()))
      const us = data.filter((d: any) => d.kind === 'receivable')
      const them = data.filter((d: any) => d.kind === 'payable')
      const fmt = (list: any[]) => list.map((d) =>
        `• ${d.party_name} — <b>${iqd(d.remaining)}</b>${d.overdue ? ' ⚠️ متأخر' : d.due_on ? ` (${d.due_on})` : ''}`).join('\n')
      return send(chat,
        `💳 <b>الديون المفتوحة</b>\n\n<b>لنا (${us.length}):</b>\n${fmt(us) || '—'}\n\n<b>علينا (${them.length}):</b>\n${fmt(them) || '—'}\n\n` +
        `مجموع ما لنا: <b>${iqd(us.reduce((s, d: any) => s + Number(d.remaining), 0))}</b>`,
        rows(backRow()))
    }

    case 'debtRep': {
      const days = Number(arg ?? 1)
      const from = days === 1 ? today() : shift(days - 1)
      const [{ data: added }, { data: paid }] = await Promise.all([
        db.from('debts').select('amount, kind').gte('created_at', from),
        db.from('debt_payments').select('amount').gte('paid_on', from),
      ])
      const label = { 1: 'اليوم', 7: 'الأسبوع', 30: 'الشهر', 365: 'السنة' }[days] ?? `${days} يوم`
      const newUs = (added ?? []).filter((d: any) => d.kind === 'receivable').reduce((s, d: any) => s + d.amount, 0)
      const newThem = (added ?? []).filter((d: any) => d.kind === 'payable').reduce((s, d: any) => s + d.amount, 0)
      const collected = (paid ?? []).reduce((s, p: any) => s + p.amount, 0)
      const { data: open } = await db.from('debts_view').select('remaining, kind, overdue').is('settled_at', null)
      const totalOpen = (open ?? []).filter((d: any) => d.kind === 'receivable').reduce((s, d: any) => s + Number(d.remaining), 0)
      const overdue = (open ?? []).filter((d: any) => d.kind === 'receivable' && d.overdue).reduce((s, d: any) => s + Number(d.remaining), 0)
      return send(chat,
        `💳 <b>دفتر الديون — ${label}</b>\n\n` +
        `ديون جديدة لنا: <b>${iqd(newUs)}</b>\n` +
        `ديون جديدة علينا: <b>${iqd(newThem)}</b>\n` +
        `المُحصَّل: <b>${iqd(collected)}</b>\n\n` +
        `📌 مجموع المفتوح لنا: <b>${iqd(totalOpen)}</b>\n` +
        (overdue > 0 ? `⚠️ منها متأخر: <b>${iqd(overdue)}</b>` : '✅ لا ديون متأخرة'),
        rows(backRow()))
    }

    case 'exp': {
      const days = Number(arg ?? 1)
      const from = days === 1 ? today() : shift(days - 1)
      const { data } = await db.from('expenses')
        .select('amount, note, spent_on, expense_categories(name)').gte('spent_on', from).order('spent_on', { ascending: false })
      const total = (data ?? []).reduce((s, e: any) => s + e.amount, 0)
      if (!data?.length) return send(chat, 'لا مصاريف في هذه الفترة.', rows(backRow()))
      return send(chat, `💸 <b>المصاريف — ${days === 1 ? 'اليوم' : 'هذا الشهر'}</b>\nالمجموع: <b>${iqd(total)}</b>\n\n` +
        data.slice(0, 25).map((e: any) =>
          `• ${e.expense_categories?.name ?? '—'} — ${iqd(e.amount)}${e.note ? ` (${e.note})` : ''} — ${e.spent_on}`).join('\n'),
        rows(backRow()))
    }
  }
  void admin
}

async function sendSales(chat: number, from: string, to: string, title: string) {
  const { data, error } = await db.rpc('finance_summary', { p_from: from, p_to: to })
  if (error || !data) return send(chat, '⚠️ تعذّر التقرير.', rows(backRow()))
  const net = data.sales_total - data.expenses - data.purchases
  return send(chat,
    `📊 <b>${title}</b>\n<code>${from} → ${to}</code>\n\n` +
    `🧾 الطلبات: <b>${data.orders_count}</b>\n` +
    `📦 بضاعة: <b>${iqd(data.sales_goods)}</b>\n` +
    `🚚 توصيل: <b>${iqd(data.sales_delivery)}</b>\n` +
    `💰 إجمالي المبيعات: <b>${iqd(data.sales_total)}</b>\n` +
    `  ├ نقد: ${iqd(data.sales_cash)}\n  └ آجل: ${iqd(data.sales_debt)}\n\n` +
    `💸 مصاريف: <b>${iqd(data.expenses)}</b>\n` +
    `📥 مشتريات: <b>${iqd(data.purchases)}</b>\n` +
    `━━━━━━━━━━━━━\n` +
    `${net >= 0 ? '📈' : '📉'} <b>الصافي: ${iqd(net)}</b>\n\n` +
    `💳 ديون مفتوحة: ${iqd(data.debts_open)}` +
    (data.debts_overdue > 0 ? `\n⚠️ متأخرة: <b>${iqd(data.debts_overdue)}</b>` : ''),
    rows(backRow()))
}

async function listCategories(chat: number) {
  const { data } = await db.from('categories').select('id, name').order('sort_order')
  return send(chat, '🏷 <b>الأصناف</b>\n\n' + (data ?? []).map((c) => `• ${c.name}`).join('\n'),
    rows([['➕ إضافة صنف', 'f:addCategory']], backRow()))
}

async function listZones(chat: number) {
  const { data } = await db.from('delivery_zones').select('id, name, fee, is_active').order('sort_order')
  return send(chat, '🚚 <b>أسعار التوصيل</b>\nاضغط منطقة لتعديل أجرتها:',
    rows(...(data ?? []).map((z) =>
      [[`${z.is_active ? '' : '⏸ '}${z.name} — ${iqd(z.fee)}`, `zone:${z.id}`]] as Array<[string, string]>),
      backRow()))
}

// -------------------------------------------------------------- مساعدات
function parseQty(text: string): { dozen: number; singles: number } | null {
  const parts = String(text).trim().split(/[\s،,x×*]+/).map((p) => p.replace(/[^\d]/g, '')).filter(Boolean)
  if (!parts.length) return null
  if (parts.length === 1) return { dozen: 0, singles: Number(parts[0]) }
  return { dozen: Number(parts[0]), singles: Number(parts[1]) }
}

async function findProduct(term: string) {
  const q = term.trim()
  if (!q) return null
  const { data: byCode } = await db.from('products')
    .select('id, name, quantity_single').eq('barcode', q).maybeSingle()
  if (byCode) return byCode
  const { data } = await db.from('products')
    .select('id, name, quantity_single').ilike('name', `%${q}%`).limit(1)
  return data?.[0] ?? null
}

/** تنزيل صورة من تيليغرام ورفعها إلى Storage */
async function uploadPhoto(fileId: string, productId: string): Promise<string | null> {
  try {
    const info = await tg('getFile', { file_id: fileId })
    const path = info?.result?.file_path
    if (!path) return null
    const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`)
    const bytes = new Uint8Array(await res.arrayBuffer())

    const { error } = await db.storage.from('product-images')
      .upload(`${productId}.jpg`, bytes, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
    if (error) return null

    const { publicUrl } = db.storage.from('product-images').getPublicUrl(`${productId}.jpg`).data
    return `${publicUrl}?v=${Date.now()}`
  } catch {
    return null
  }
}

async function quickSearch(chat: number, term: string, admin: boolean) {
  const p = await findProduct(term)
  if (!p) return send(chat, '❌ لم أجد منتجاً مطابقاً. اكتب /start للقائمة.', mainMenu(admin))
  let extra = ''
  if (admin) {
    const { data: pr } = await db.from('product_prices').select('*').eq('product_id', p.id).maybeSingle()
    extra = `\nالمفرد: ${iqd(pr?.price_retail ?? 0)}\nالجملة: ${iqd(pr?.price_wholesale ?? 0)} للقطعة`
  }
  return send(chat, `📦 <b>${p.name}</b>\nالرصيد: <b>${p.quantity_single}</b> قطعة${extra}`,
    rows([['📥 إضافة كمية', 'f:addStock']], admin ? [['💵 تسعير', 'f:setPrice']] : [], backRow()).filter((r) => r.length))
}
