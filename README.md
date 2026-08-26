# أسواق الرفاعي — نظام المخزون والمتجر الإلكتروني

العراق – الأنبار – الرمادي – شارع السينما – فرع الشورجة.
مخزون + إدخال بالباركود + متجر إلكتروني + طلبات عبر واتساب.

## التقنيات
React (Vite) · Tailwind CSS v4 · Lucide React · html5-qrcode · Supabase (Postgres, Auth, Storage, Edge Functions)

## الحالة الحالية

قاعدة البيانات **منفّذة فعلياً** على المشروع `wyovsacbogqfojtacast` وفحوصات السلامة نجحت كلها،
وملف `.env` معبّأ بمفاتيح المشروع. يبقى إجراء واحد يدوي: إنشاء حساب المدير (أدناه).

### الخطوة اليدوية الوحيدة — حساب المدير
Supabase يسجّل الدخول بالبريد الإلكتروني لا باسم مستخدم، فاختر بريداً ولو داخلياً.

1. Supabase → **Authentication → Users → Add user → Create new user**
   - Email: `admin@alrifaie.com`
   - Password: كلمة السر التي تريدها
   - فعّل **Auto Confirm User** (وإلا لن يستطيع الدخول قبل تأكيد البريد)
2. **SQL Editor** ونفّذ هذا السطر كما هو — لا تحتاج نسخ أي رقم:
   ```sql
   update public.profiles p set role = 'admin'
     from auth.users u
    where u.id = p.id and u.email = 'admin@alrifaie.com';
   ```
3. للتأكد:
   ```sql
   select u.email, p.role from public.profiles p join auth.users u on u.id = p.id;
   ```

أي حساب يُنشأ لاحقاً يبدأ تلقائياً بدور `data_entry` — لا يحتاج منك شيئاً.

### التشغيل
```bash
npm install
npm run dev
```
ماسح الباركود يحتاج `https` أو `localhost` (شرط المتصفح للكاميرا).
لفتح اللوحة من الجوال أثناء التطوير استعمل عنوان الشبكة الذي يطبعه Vite.

### إعادة تنفيذ المخطط أو تعديله
الملف `supabase/schema.sql` قابل لإعادة التنفيذ بأمان. نفّذه إما بلصقه في SQL Editor أو:
```bash
PGPASS='كلمة-سر-قاعدة-البيانات' node supabase/run-sql.mjs supabase/schema.sql db.wyovsacbogqfojtacast.supabase.co 5432 postgres
```

## هيكل المشروع
```
supabase/
  schema.sql          # المخطط الكامل: جداول، دوال، RLS، Storage
  smoke-test.sql      # فحص سريع لسلامة المخطط والصلاحيات (10 فحوصات)
  run-sql.mjs         # أداة تنفيذ ملف SQL على قاعدة البيانات من الطرفية
src/
  lib/supabase.js     # عميل Supabase الوحيد (anon key فقط)
  lib/format.js       # تنسيق الدينار العراقي ومنطق الدزينة
  context/            # AuthContext: الجلسة والدور        (المرحلة 2)
  components/         # الماسح، رفع الصور، نموذج المنتج، السلة (المراحل 2–3)
  pages/storefront/   # المتجر العام                        (المرحلة 3)
  pages/dashboard/    # الدخول، الإدخال، الطلبات، الأسعار    (المراحل 2 و5)
```

## قواعد ثابتة
- **الأسعار في جدول منفصل** (`product_prices`) يقرؤه المدير وحده — لأن RLS تعمل على
  مستوى الصفوف لا الأعمدة. المتجر يقرأ سعر المفرد عبر العرض `storefront_products`
  الذي لا يكشف سعر الجملة أبداً.
- **الطلب يُنشأ عبر `create_order`** التي تقرأ الأسعار من قاعدة البيانات وتحسب المجموع
  بنفسها. رابط `wa.me` يُبنى **بعد** نجاح الحفظ ومن رد الدالة، لا من السلة.
- **الكميات تتغير عبر `stock_movements` فقط** — لا تعديل مباشر على `quantity_single`.
- **المبالغ `bigint`** بالدينار العراقي، والعرض بـ `Intl.NumberFormat('ar-IQ')`.
- **الواجهة RTL** — استعمل `ms-/me-/ps-/pe-/start-/end-` لا `ml-/mr-/left-/right-`.

## المراحل
1. ✅ قاعدة البيانات وأساس المشروع — **منفّذة على Supabase**
2. ⬜ الدخول والأدوار ولوحة الإدخال (باركود، صور، دزينة)
3. ⬜ المتجر والسلة
4. ⬜ تدفق الطلب عبر واتساب
5. ⬜ لوحة المدير: الطلبات والأسعار والتقارير
6. ⬜ بوت التيليغرام
