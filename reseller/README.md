# متجر الزبون — تطبيق المروّجين المستقل

تطبيق Vite + React + Tailwind 4 منفصل تماماً عن واجهة الرفاعي (`src/`). لا يستورد منها شيئاً، ولا يحمل اسماً ولا شعاراً ولا نطاقاً ولا رقماً لها: هوية الصفحة كلها من `reseller_store` (الاسم، الشعار، اللون، النبذة، واتساب).
الاعتماديات: `react`, `react-dom`, `lucide-react`, `@supabase/supabase-js` فقط.

## البيانات
ثلاث دوال فقط (مسودات 018): `reseller_store(slug)` (تتضمن مناطق زاد)، `reseller_store_products(slug)`، `reseller_create_order(...)`. الأسعار والكميات تأتي محسوبة من الخادم؛ الواجهة تعرضها فقط (`src/lib/qty.js` يطابق قواعد `src/lib/price.js`: العلبة وأقل كمية).
- الكمية المرسلة للخادم **قطع** (وحدات × `pack_qty`)، وثمن البند = السعر × الوحدات، و`p_expected_total` يشمل أجرة التوصيل.
- متجر غير موجود/موقوف/قيد المراجعة تظهر لها شاشة واحدة (الخادم لا يفرّق عمداً).

## التجربة المحلية (بلا الحيّ)
```powershell
node reseller/dev/stack.mjs up      # Postgres معزول (شبكة داخلية) + المسودات 015–020 + بيانات وهمية + PostgREST على 127.0.0.1:3101
npm --prefix reseller run dev       # http://localhost:5180/s/noor-store  (أو noor-store.localhost:5180)
node reseller/dev/stack.mjs sql "…" # تغيير حالة القاعدة (سعر، مخزون، reseller_orders_enabled…)
node reseller/dev/stack.mjs down
```
متاجر التجربة: `noor-store` (شعار)، `sunny-corner` (لون فاتح)، `paused-shop` (موقوف)، `review-shop` (قيد المراجعة).

## للإنتاج (المرحلة 5، لم يُنفَّذ)
- `/api/*` يمرّره وكيل (Worker) إلى القاعدة ويحقن المفتاح، فلا يظهر مشروع القاعدة في المتصفح.
- **صور المنتجات** تأتي اليوم من `products.image_url` (رابط تخزين الرفاعي) وتُعرض كما هي؛ الوكيل `/i/<id>` يستبدلها قبل أي نشر.
- og والعنوان لكل متجر يحقنهما الاستضافة؛ `index.html` محايد ويحمل `noindex` مؤقتاً.
- `VITE_ROOT_DOMAIN` للنطاق الجذر عند شرائه.
