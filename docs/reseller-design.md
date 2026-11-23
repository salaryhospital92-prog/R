# متاجر المروّجين — تصميم المرحلة 0

الأرقام مقروءة من القاعدة الحيّة (قراءة فقط) يوم 2026-11-23. لا شيء هنا مطبَّق.
ترقيم: `012` عرض الجملة (مطبَّق) · `013` إغلاق التسجيل (مسودة) · `014+` المنصة.

## 1) قرارات التصميم المختصرة

| القرار | السبب |
|---|---|
| لا سياسة جديدة على `orders` للمروّج؛ يقرأ عبر `reseller_my_orders()` | السياسة تكشف كل الأعمدة (هاتف الزبون، الباركود)، و`orders` منشورة في realtime |
| لا عروض (views) عامة جديدة، دوال فقط | صلاحيات المشروع الافتراضية تعطي anon/authenticated كل شيء على أي عرض جديد، وعرض بسيط فوق جدول واحد قابل للكتابة بصلاحية مالكه |
| عمود `orders.reseller_store_id` (قابل للفراغ) | `notify_new_order` يعمل لحظة الإدراج، قبل وجود صف `reseller_orders`، ويحتاج اسم المتجر؛ ويكفي المشرفَ لمعرفة المتجر بلا رؤية الأساس والربح |
| اسم البند في `items_json` هو اسم الرفاعي الحقيقي | التجهيز والإشعار وtop_products تعتمد عليه؛ الاسم المخصّص في `reseller_order_items.display_name` |
| طلب مروّج لا يُعدَّل سعره ولا خصمه | الربح لقطة ثابتة. الخطأ يُحل بإلغاء وطلب جديد أو `adjustment` |
| الرصيد مشتق من القيود فقط، وكل دالة مالية تقفل صف المتجر أولاً | منع الحجز والدفع المزدوجين |
| قيود `(order_id, kind, cycle)` بدل `(order_id, kind)` | «مُسلَّم» في البوت ضغطة بلا تأكيد؛ نحتاج تسليم ← تراجع ← تسليم صحيحاً دون تكرار |
| حساب الاستلام: صفوف لا تُعدَّل، التغيير صف جديد | طلب الدفع يشير إلى الحساب الذي حُجز له؛ والتاريخ هو سجل التغيير |
| المروّج خارج `profiles.role` كلياً | 013 يبقي له صفاً **موقوفاً** في profiles (مطلوب لمفاتيح `created_by`) |

## 2) الجداول

كلها: `enable row level security`، ثم `revoke all … from anon, authenticated`، ثم منح صريح فقط. (زناد `ensure_rls` الحيّ يفعّل RLS لكنه لا يسحب المنح.) المبالغ bigint.

**reseller_stores** — `id uuid pk`, `owner_id uuid unique not null → auth.users on delete restrict`, `slug text unique check (slug ~ '^[a-z0-9](-?[a-z0-9]){2,29}$')` + زناد قائمة محجوزة، `name text check(2..40)`, `logo_path`, `theme_color check (~ '^#[0-9a-f]{6}$')`, `phone`, `whatsapp`, `about check(<=500)`, `status check in (draft,pending,active,suspended,rejected) default draft`, `status_reason`, `decided_at`, `decided_by text`, `markup_type check in (fixed,percent)`, `markup_value bigint check(>=0)`, `round_to int check in (1,250,500,1000) default 250`, `created_at`.
*إضافة على المواصفة:* `draft` (قبل الإرسال) و`rejected` (قابل للتعديل وإعادة الإرسال).

**reseller_categories** — pk `(store_id, category_id)`.
**reseller_products** — pk `(store_id, product_id)`, `is_visible bool default true`, `price_override bigint check(>0)`, `display_name check(<=120)`, `display_description check(<=1000)`.

**reseller_orders** — `order_id uuid pk → orders on delete restrict`, `store_id`, `base_subtotal`, `reseller_subtotal`, `profit generated always as (reseller_subtotal - base_subtotal) stored check(>=0)`, `promo_on bool` (حال العرض وقت الطلب), `base_mode text`, `cycle int default 0`, `cancel_requested_at`, `cancel_reason`.
**reseller_order_items** — pk `(order_id, line_no)`, `product_id`, `qty check(>0)`, `base_unit`, `sell_unit check(>=base_unit)`, `display_name`.
**reseller_ledger** — `id`, `store_id`, `kind check in (profit_due,reversal,payout,adjustment)`, `amount bigint check(<>0)` موقّع، `order_id`, `cycle`, `payout_id`, `note`, `created_by text`, `created_at`. فريد جزئي `(order_id,kind,cycle) where order_id is not null` و`(payout_id) where kind='payout'`. زناد يرفض update/delete حتى لـservice_role.
**reseller_payout_accounts** — `id`, `store_id`, `method check in (zaincash,qicard)`, `account_no`, `holder_name`, `is_current`, `created_at`. فريد جزئي `(store_id,method) where is_current`. زين كاش `^07\d{9}$`؛ كي كارد أرقام فقط بطول محدود. لا أعمدة PIN/CVV/انتهاء/OTP. زناد يمنع تعديل `account_no`.
**reseller_payouts** — `id`, `store_id`, `account_id`, `amount check(>0)`, `origin check in (auto,manual)`, `status check in (open,paid,cancelled,rejected)`, `reference`, `decided_by`, `decided_at`, `reason`, `created_at`. فريد جزئي `(store_id) where status='open'`؛ `check (status<>'paid' or nullif(trim(reference),'') is not null)`.
**reseller_product_requests** — `store_id`, `name`, `image_path`, `url check(https)`, `expected_qty`, `note`, `status check in (new,reviewing,available,rejected)`, `reply`, `product_id`; حد 20 مفتوحاً لكل متجر.
**reseller_telegram** — `store_id pk`, `chat_id unique`, `code unique`, `code_expires_at` (15 دقيقة), `linked_at`.

تعديل قائم (إضافي): `orders.reseller_store_id`، `orders_source_check` يضاف إليه `reseller`، `products.reseller_excluded bool default false` (الصور المكتوب عليها اسم الرفاعي).
Bucket `reseller-logos`: عام للقراءة، 1MB، png/jpeg/webp، المسار `<auth.uid()>/…` للكتابة.
إعدادات `app_settings`: `reseller_base`، `reseller_max_markup_percent` (فارغ = بلا سقف)، `reseller_payout_threshold`=25000، `reseller_domain`، `reseller_orders_enabled` (قاطع طوارئ، off ابتداءً).

## 3) مصفوفة الصلاحيات

ق=قراءة، ك=كتابة، د=عبر دالة فقط، —=لا شيء. المروّج «أ» لا يصل إلى «ب» في أي خانة.

| | anon | مالك المتجر | مشرف الرفاعي | مدير الرفاعي | mona_admin | service_role |
|---|---|---|---|---|---|---|
| reseller_stores | د (الفعّال، حقول علنية) | ق صفّه؛ ك د | ق | ق؛ ك د | — | ق د |
| reseller_categories / products | د (المحصلة) | ق ك صفوفه (غير معلَّق) | — | ق | — | ق |
| reseller_orders / items | — | ق صفوفه | — (الأساس والربح محجوبان) | ق | — | ق |
| reseller_ledger | — | ق صفوفه | — | ق؛ adjustment د | — | د |
| reseller_payout_accounts | — | ق صفوفه (مقنّع في الواجهة)؛ ك د | — | د (كشف كامل مسجَّل) | — | مقنّع د |
| reseller_payouts | — | ق صفوفه؛ طلب/إلغاء د | — | ق؛ دفع/رفض د | — | د |
| reseller_product_requests | — | ق؛ إضافة | ق | ق ك | — | ق |
| reseller_telegram | — | د | — | — | — | ق ك |
| orders (source=reseller) | — | د (`reseller_my_orders`) | ق، تأكيد جديد (سياسة قائمة `<> 'mona'`) | ق ك (قائمة) | — | كل |
| products / product_prices | — | د (`reseller_catalog`) | قائم | قائم | قائم | كل |
| إعدادات reseller_* | — | — | — | ق ك | — (مفاتيحه `mona_` فقط) | كل |

`service_role` يتجاوز RLS دائماً؛ لذلك الدوال المالية تتحقق أيضاً من هوية المدير (القسم 6).

## 4) التواقيع

كل دالة `security definer set search_path = public` **مع** `revoke execute … from public, anon, authenticated` ثم منح صريح — لأن الافتراضي الحيّ يمنح anon تنفيذ كل دالة جديدة.

```
-- التسعير: موضع واحد للعرض والطلب
reseller_suspect(w bigint, r bigint) → bool        -- w>0 and r>0 and (w>r or r>=3*w)
reseller_base_price(w, r) → bigint                 -- null إن مشبوهاً أو صفراً، وإلا
                                                   -- rifai_price(w, r, <reseller_base>, <promo_wholesale_all='on'>)
reseller_price(base, override, type, value, round_to, cap_pct) → bigint
   -- override ثم markup؛ تقريب لأعلى؛ لا أقل من base؛ لا أعلى من السقف؛ base null ⇒ null ⇒ لا يظهر

-- anon
reseller_store(slug) → jsonb                       -- الفعّال فقط
reseller_store_products(slug) → table(id, name, category, image_path, price, in_stock)
reseller_create_order(slug, name, phone, items jsonb, zone_id, note, expected_total bigint) → jsonb

-- المالك
reseller_save_store(jsonb), reseller_submit_store(), reseller_catalog(),
reseller_my_orders(limit, before), reseller_request_cancel(order_id, reason),
reseller_balance() → {pending, due, reserved, available, paid}, reseller_statement(limit, before),
reseller_save_payout_account(method, account_no, holder), reseller_request_payout(), reseller_cancel_payout(id),
reseller_telegram_code()

-- المدير (ويب: is_admin() — بوت: service_role + p_telegram_id مدير فعّال في telegram_agents)
reseller_decide_store(store_id, action, reason, p_telegram_id default null)
reseller_payout_paid(payout_id, reference, p_telegram_id default null)
reseller_payout_reject(payout_id, reason, p_telegram_id default null)
reseller_payout_reveal(payout_id) → الحساب كاملاً  -- ويب فقط، ويُسجَّل
reseller_adjust(store_id, amount, note)
```

**الطلب:** المتصفح يرسل `{product_id, qty}` فقط. `expected_total` ليس سعراً معتمداً: إن خالف المحسوب يُرفض «تغيّر السعر، راجع السلة» (مهم لحظة إطفاء العرض). القفل: البنود مرتبة بـ`product_id` ثم `for update` (منع تشابك طلبين). الزناد القائم `apply_stock_movement` يقفل ويرفض السالب أصلاً، فالسباق محمي في العمق. `stock_movements.created_by = null` صراحة حتى لا تتوقف على ملف الزائر. الحد: 5 طلبات/ساعة للهاتف، 30/ساعة للمتجر. `delivery_fee` من المنطقة. الرد بلا code/barcode/أساس.

**الأساس والعرض المؤقت (قرار المالك المبلَّغ):** الأساس = السعر الفعلي نفسه عبر `rifai_price` القائمة. النتائج:
- إطفاء `promo_wholesale_all` **يغيّر أساس المروّج فوراً**؛ لقطات الطلبات السابقة لا تتحرك (مخزَّنة بالبند مع `promo_on`/`base_mode`).
- سعر ثابت صار أقل من الأساس الجديد يُرفع إلى الأساس (ربح 0) ويُنبَّه المروّج؛ لا بيع تحت الأساس.
- العرض شغّال: 0 منتج بلا أساس. مُطفأ: 43 تختفي لو `reseller_base='wholesale'`، و3 لو `'retail'`؛ وفي وضع retail يرتفع الأساس في 153 منتجاً.
- المشبوه مستبعد حتى يُصحَّح: 7 اليوم (3 جملتها أعلى + 4 مفردها ≥ 3 أضعاف). **تنبيه:** `rifai_price` الحيّة تستعمل عتبة **ضعفين**؛ منتج واحد بين الضعفين والثلاثة يدخل متاجر المروّجين خارج العرض. المقترح توحيدها على ضعفين (8 مستبعدة)، وعندها لا يفرق وضع الأساس لأي منتج أثناء العرض.

## 5) آلات الحالة

**المتجر:** `draft → pending → active ⇄ suspended`؛ `pending → rejected → pending`. التفعيل `update … where status='pending' returning` — الضغطة الثانية لا تجد صفاً وتُردّ «عولج سابقاً بواسطة…». متجر موقوف: لا طلبات ولا تعديل ولا طلب دفع؛ مستحقه محفوظ.

**الطلب والربح:**
```
new / confirmed      → الربح «معلّق» (محسوب من reseller_orders، بلا قيد)
→ delivered          → cycle+1، قيد profit_due(+profit)         ثم فحص العتبة
delivered → أي حالة  → قيد reversal(−profit) لنفس cycle (مرة واحدة: فريد)
cancelled            → المخزون يعيده الزناد القائم؛ لا ربح
زاد failed/cancelled → الطلب يبقى confirmed؛ لا ربح
```
زناد واحد `after update of status when (source='reseller')`. فشله يُفشل تغيير الحالة عمداً (مال)؛ و`zad_poll` يلتقط الخطأ لكل رحلة ويعيد المحاولة في الدقيقة التالية. زناد `before update` يرفض تغيّر `items_json/subtotal/discount/source/reseller_store_id` ويشترط `total_amount = subtotal + delivery_fee`؛ فيرفض `price_order_item` والخصم على طلبات المروّج.

**طلب الاستلام:**
```
available = Σ ledger − Σ payouts(open)
            ┌ cancelled (المروّج) ┐
open ───────┼ rejected (المدير)   ┼→ الحجز يزول تلقائياً، ثم يُعاد فحص العتبة
            └ paid (مرجع إلزامي)  ┘→ قيد payout(−amount)
```
- يدوي: كل `available` ما دام > 0 وله حساب استلام ومتجره فعّال.
- تلقائي: بعد `profit_due` أو حفظ حساب أو إغلاق طلب: `available ≥ reseller_payout_threshold` ولا مفتوح ⇒ `insert … on conflict do nothing`. بلا حساب استلام: لا يُنشأ، وتظهر له دعوة لإدخال الحساب، ويُنشأ عند حفظه.
- مفتوح واحد: الفهرس الجزئي. ما يستحق أثناءه ينتظر التالي.
- `paid` يتحقق تحت القفل أن `Σ ledger ≥ amount`، وإلا «تغيّر المستحق بعد إلغاء طلب — ارفض الطلب وأعد حسابه».
- عكس بعد الدفع يجعل الرصيد سالباً يُخصم من اللاحق؛ لا مطالبة آلية.
- النظام لا يحوّل مالاً.

## 6) البوت

`callback_data` (UUID = 36 بايت): `rsok:` `rsno:` (متجر) و`rpgo:` `rpok:` `rpno:` (دفع) = **41 بايت** لكل زر، والحد 64. لا سبب ولا مبلغ ولا حساب داخل الزر.

1. إرسال متجر ← زناد ← `net.http_post` لكل مدير (داخل `exception when others`): الاسم، الرابط، رابط الشعار (معاينة)، زرّا ✅/✖️. ✖️ يطلب السبب نصاً.
2. المعالج: `agent.role==='admin'` **و** الدالة تعيد التحقق من `p_telegram_id` في `telegram_agents`. مطلوب فعلاً: `ADMIN_ONLY` يفحص المفتاح النصي فقط ولا يغطي أزرار UUID، وعميل MTProto معدَّل يرسل أي `callback_data`.
3. طلب استلام: المتجر، المبلغ، الطريقة، الحساب **مقنّعاً** (`07•••••1234`)، وتحذير إن تغيّر الحساب خلال 72 ساعة. «تم التحويل» ← يطلب المرجع ← `reseller_payout_paid`. الحساب الكامل في لوحة الويب فقط.
4. تغيير الحساب يُشعر المديرين مقنّعاً.
5. ربط المروّج: `/start rs_<رمز>` يُعالَج **قبل** `authorize()` (الذي يتجاهل الغرباء، ويجعل أول مستخدم مديراً إن فرغ الجدول). لا يُنشئ صفاً في `telegram_agents` أبداً. الرمز يحوي `_` فلا يطابق نمط الدعوات `^[A-Z0-9]{6,10}$`.
6. بديل الويب: نفس الدوال من شاشة «مروّجون».

## 7) المحاسبة

تُبنى على التعريفات الحيّة. `left join reseller_orders ro` والاستبدال `subtotal → subtotal - coalesce(ro.profit,0)` ومثلها `total_amount`. طلبات غير المروّج لا تتغير بدينار.

- **finance_summary:** goods/total/cash/debt صافية + مفاتيح جديدة `reseller_gross`, `reseller_profit`, `reseller_payable`. هي security invoker: المشرف لا يرى `reseller_orders` فيرى إجمالياً؛ الشاشة للمدير أصلاً، ويُمنع النداء لغير المدير/الخادم.
- **top_products:** إيراد بنود المروّج من `reseller_order_items.base_unit`.
- **send_daily_sales_report:** الخمسة المجاميع + الأمس + الأكثر مبيعاً.
- مثال القبول: أساس 7000، بيع 10000، توصيل 2000 ⇒ subtotal 10000، total 12000، زاد 10000 (مؤكَّد من `zad_dispatch`: ‏`total_amount - delivery_fee`)، ربح 3000، صافي الرفاعي 7000.
- الدفعات **لا تُسجَّل** في `expenses`: الربح خُصم من المبيعات، فتسجيلها خصم مزدوج.

## 8) قائمة تسرّب العلامة

| الموضع | الحال | العلاج |
|---|---|---|
| النطاق، og، manifest/PWA، `<title>`، `alrifaie-cart`، نص واتساب | كلها في تطبيق الرفاعي | تطبيق `reseller/` مستقل بلا استيراد من `src/lib/store.js`, `orderText.js` |
| روابط الصور `…supabase.co/product-images/<uuid>.jpg` (246/246) | نفس رابط alrifai.shop — بحث عكسي يكشف | وكيل `/i/<id>` على نطاق المروّج |
| مرجع مشروع Supabase ومفتاح anon في الشبكة | بهما يقرأ أي زائر `storefront_products` **بما فيه سعر الجملة** | وكيل `/api/*`؛ والكشف نفسه قائم اليوم (تنبيه، لم أغيّره) |
| الشعار/النص داخل الصور | **لم يُتحقق** (يحتاج OCR/نظر) | `products.reseller_excluded` |
| `description` | وصف واحد فقط من 246، وبلا ذكر الرفاعي | لا يُعرض |
| أسماء المنتجات | 0 يحوي «رفاع/rifai» | — |
| code/barcode | تبحث في جوجل فتصل للرفاعي | لا تُرجع للزبون |
| رسالة الكابتن واسم المتجر في تطبيق زاد، وهاتف الكابتن | الحمولة `طلب #رقم` بلا علامة؛ اسم الحساب عند زاد **غير معروف** | سؤال للمالك/زاد |
| الكيس، الفاتورة، رقم المتصل عند التأكيد | بشري | سؤال للمالك |
| رقم الطلب المتسلسل المشترك | يكشف حجم الطلبات لا العلامة | يُعرض كما هو |
| رسائل Auth (قالب/Site URL) | تصل المروّج لا الزبون | قالب محايد عند الإطلاق |

## 9) الاستضافة (اقتراح — لا شراء ولا نشر)

**Cloudflare Pages + Worker**: ‏wildcard `*.النطاق` بشهادة واحدة، Worker يحقن og لكل متجر (`HTMLRewriter`)، ويمرّر `/api` و`/i`. GitHub Pages بلا wildcard؛ Vercel المجاني لا يسمح بالاستعمال التجاري. *(من معرفة عامة؛ تُراجَع الشروط والأسعار عند القرار.)*
لوحة المروّج على `app.النطاق` منفصلة عن المتاجر حتى لا تشارك متاجرُ المسار جلسة الدخول. `/s/:slug` للتطوير فقط. `noindex` لمتجر غير فعّال.

## 10) الإطلاق والتراجع

1. **013 أولاً وحده** (بعد موافقة المالك): تحقّق قبله أن `profiles` ما زالت 3 فعّالة (2 admin، 1 mona_admin)؛ غريبٌ فعّال ⇒ أوقفه. إعادة التسمية إلى `.sql` ثم `npm run db` (لا `ship`). ثم أعد عدّ الثلاثة ودخول مدير واحد. بديل فوري بلا ترحيل: إطفاء «Allow new users to sign up» من لوحة Supabase.
   تراجع 013: دالتا 001/schema القديمتان — **لا** يُعاد الافتراضي إلى true.
2. مع 013 في الواجهة: `AuthContext` يقرأ `is_active` ويعامل الموقوف كمن لا ملف له (اليوم يرى هيكل لوحة فارغاً؛ RLS يحمي البيانات).
3. `014` جداول وقواعد، `015` الدوال والزنادات، `016` المحاسبة (وحدها، مع ملف تراجع فيه `pg_get_functiondef` السابق). كلها معاملات؛ لا enum جديد.
4. القاطع `reseller_orders_enabled=off` حتى تجربة متجر المالك؛ ثم 3 متاجر؛ ثم فتح.
5. التراجع: القاطع off + تعليق المتاجر. الجداول المالية **لا تُحذف**؛ `orders_source_check` لا يُضيَّق ما دام فيه طلب reseller.
6. خطر تشغيلي: `npm run ship` يطبّق كل `.sql` جديد ويرفع main وينشر البوت — لا تُدمج ملفات `.sql` قبل موافقتها. وإعادة تشغيل `operations.sql` تعيد دوالّ قديمة فوق سياج 011 وما بعده (محلياً لا يُنفَّذ أصلاً قبل 010: يستدعي `is_mona_admin`).

## 11) ما لم يُجب عنه المالك بعد

1. **إغلاق ثغرة التسجيل (013) على القاعدة الحيّة**: موافق؟ (أو إطفاء التسجيل من اللوحة الآن.)
2. بعد انتهاء العرض: أساس المروّج الجملة أم المفرد؟ ومعه: 236 من 246 تُباع عندك بالدرزن، والمروّج يبيع **قطعة واحدة** بأساس الجملة — مقبول؟ (فرق المفرد عن الجملة 20% وسطياً في 158 منتجاً.)
3. الزبون يرفض الاستلام: من يتحمل أجرة زاد؟ (الافتراض: لا ربح ولا غرامة.)
4. سقف السعر الأعلى؟ (الافتراض: بلا سقف.)
5. من يتصل بالزبون، وهل يرى المروّج هاتفه؟ (الافتراض: الرفاعي يتصل، والهاتف مخفي عن المروّج.)
6. هل يُعرض كل مخزون الرفاعي للمروّجين أم أصناف منه؟
7. الربح مستحق فور «مُسلَّم»، أم بعد مهلة إرجاع (مثلاً 3 أيام)؟
8. كي كارد: رقم حساب/محفظة أم رقم البطاقة الـ16؟ (ننصح بغير رقم البطاقة.)
9. تغيير اسم المتجر أو شعاره بعد التفعيل: إشعار فقط أم موافقة جديدة؟ (الافتراض: إشعار.)
10. ماذا يظهر للزبون من اسم الرفاعي في تطبيق زاد والكيس والفاتورة؟
11. من يعلّم الصور المكتوب عليها اسم الرفاعي؟ (246 صورة.)
12. بريد التأكيد: تسجيل المروّجين يحتاج مرسِل بريد (SMTP) خاصاً؛ بريد Supabase المدمج محدود جداً.
