// بيانات تجربة وهمية بالكامل لقاعدة المروّجين المحلية (لا شيء من الحيّ). تُولَّد SQL وصوراً SVG.
// لا صور نساء ولا وجوه: أشكال منتجات مجرّدة فقط.
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const OWNER = '00000000-0000-4000-8000-0000000000a1'
const ASSETS = fileURLToPath(new URL('./assets/', import.meta.url))

// [اسم، صنف، sold_by، pack_qty، wholesale_min، pack_only، مفرد، درزن/علبة، جملة، مخزون، شكل]
const P = [
  ['عطر رجالي «ليل» 100مل', 9101, 'dozen', 12, 1, false, 12000, 126000, 0, 120, 'bottle'],
  ['عطر خشبي بالعود', 9101, 'piece', 12, 3, false, 18000, 0, 15000, 40, 'bottle'],
  ['معطر جسم رذاذ منعش', 9101, 'dozen', 12, 1, false, 3500, 36000, 0, 500, 'tube'],
  ['عطر جيب 20مل', 9101, 'dozen', 12, 1, false, 2500, 24000, 0, 3, 'bottle'],          // مخزون قليل: 3 فقط
  ['كريم مرطب لليدين', 9102, 'dozen', 12, 1, false, 4000, 42000, 0, 200, 'jar'],
  ['غسول وجه بالصبار', 9102, 'dozen', 12, 1, false, 6000, 66000, 0, 0, 'tube'],          // نفد
  ['مرهم شفاه بالعسل', 9102, 'dozen', 12, 1, false, 1500, 15000, 0, 300, 'tube'],
  ['صابون زيت الزيتون', 9102, 'dozen', 12, 1, false, 1000, 9000, 0, 400, 'box'],
  ['شامبو بالأعشاب 400مل', 9102, 'dozen', 12, 1, false, 5000, 54000, 0, 80, 'bottle'],
  ['صمغ متعدد الاستعمالات (درزن)', 9103, 'dozen', 12, 1, true, 2000, 18000, 0, 60, 'tube'],    // يُباع درزناً: 12 قطعة
  ['بطارية قلم AA (علبة 24)', 9103, 'dozen', 24, 1, true, 0, 48000, 0, 100, 'box'],             // علبة 24: 4 علب كحد أقصى
  ['كيس قمامة كبير (علبة 25)', 9103, 'dozen', 25, 1, true, 0, 40000, 0, 30, 'box'],             // علبة 25: علبة واحدة
  ['إسفنج جلي (درزن)', 9103, 'dozen', 12, 1, true, 0, 6000, 0, 11, 'box'],                      // 11 < 12: لا تكفي علبة → نفد
  ['مجموعة بكرات خياطة', 9103, 'piece', 12, 2, false, 7000, 0, 6000, 25, 'jar'],               // أقل كمية: قطعتان في وضع الجملة
  ['ميدالية مفاتيح معدنية', 9104, 'dozen', 12, 1, false, 1000, 9000, 0, 90, 'box'],            // صنف لم يختره المتجر
  ['منتج مخفي (للتأكد أنه لا يظهر)', 9101, 'dozen', 12, 1, false, 1000, 9000, 0, 90, 'box'],
  ['منتج بلا سعر (للتأكد أنه لا يظهر)', 9101, 'dozen', 12, 1, false, 0, 0, 0, 90, 'box'],
]
// منتجات إضافية لاختبار «عرض المزيد» والبحث
for (let n = 1; n <= 45; n++) {
  const cat = 9101 + (n % 3)
  P.push([`صنف تجريبي رقم ${n}`, cat, n % 4 ? 'dozen' : 'piece', 12, 1, false, 1000 + n * 250, n % 4 ? (1000 + n * 250) * 9 : 0, 0, 100, ['bottle', 'jar', 'box', 'tube'][n % 4]])
}
const HIDDEN = 16            // رقم (1) المنتج المخفي

export const pid = (i) => `md5('dev-p${i}')::uuid`

function svg(i, kind) {
  const h = (i * 47) % 360
  const bg = `hsl(${h} 45% 92%)`, c1 = `hsl(${h} 55% 45%)`, c2 = `hsl(${h} 60% 62%)`
  const shape = {
    bottle: `<rect x="86" y="30" width="28" height="22" rx="5" fill="${c1}"/><rect x="62" y="50" width="76" height="120" rx="20" fill="${c2}"/><rect x="74" y="88" width="52" height="46" rx="8" fill="#fff" opacity=".75"/>`,
    jar: `<rect x="56" y="48" width="88" height="22" rx="8" fill="${c1}"/><rect x="48" y="66" width="104" height="94" rx="22" fill="${c2}"/><rect x="66" y="94" width="68" height="40" rx="8" fill="#fff" opacity=".75"/>`,
    box: `<rect x="44" y="52" width="112" height="112" rx="14" fill="${c2}"/><rect x="44" y="52" width="112" height="28" rx="14" fill="${c1}"/><rect x="64" y="104" width="72" height="34" rx="8" fill="#fff" opacity=".75"/>`,
    tube: `<path d="M70 40h60l8 120H62z" fill="${c2}"/><rect x="74" y="26" width="52" height="22" rx="6" fill="${c1}"/><rect x="78" y="86" width="44" height="40" rx="8" fill="#fff" opacity=".75"/>`,
  }[kind]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${bg}"/>${shape}</svg>`
}

export function writeAssets() {
  mkdirSync(`${ASSETS}p`, { recursive: true })
  mkdirSync(`${ASSETS}${OWNER}`, { recursive: true })
  P.forEach((r, i) => writeFileSync(`${ASSETS}p/${i + 1}.svg`, svg(i + 1, r[10])))
  mkdirSync(`${ASSETS}products/${OWNER}`, { recursive: true })
  writeFileSync(`${ASSETS}products/${OWNER}/own1.svg`, svg(91, 'jar'))
  writeFileSync(`${ASSETS}products/${OWNER}/own2.svg`, svg(57, 'box'))
  writeFileSync(`${ASSETS}${OWNER}/logo.svg`,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="#0f766e"/><path d="M28 62V34l40 28V34" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>')
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`

export function seedSql() {
  const rows = P.map((r, i) => `(${pid(i + 1)}, ${q(r[0])}, ${r[1]}, ${q(r[2])}, ${r[3]}, ${r[4]}, ${r[5]}, '/dev-img/p/${i + 1}.svg', ${i === HIDDEN - 1})`)
  const prices = P.map((r, i) => `(${pid(i + 1)}, ${r[6]}, ${r[7]}, ${r[8] || `round(${r[7]}::numeric / ${r[3]})`})`)
  const stock = P.map((r, i) => (r[9] > 0 ? `(${pid(i + 1)}, 'stock_in', ${r[9]})` : null)).filter(Boolean)
  const users = [[OWNER, 'owner'], ['00000000-0000-4000-8000-0000000000a2', 'two'], ['00000000-0000-4000-8000-0000000000a3', 'three'], ['00000000-0000-4000-8000-0000000000a4', 'four']]
  return `
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at) values
  ${users.map(([id, k]) => `('${id}', 'authenticated', 'authenticated', '${k === 'owner' ? 'tg111@telegram.invalid' : k + '@dev.invalid'}', now(), now())`).join(',\n  ')};

insert into public.categories (id, name) values (9101, 'عطور'), (9102, 'عناية بالبشرة'), (9103, 'منزل ومستلزمات'), (9104, 'إكسسوارات');

insert into public.products (id, name, category_id, sold_by, pack_qty, wholesale_min, pack_only, image_url, reseller_hidden)
values ${rows.join(',\n  ')};

alter table public.product_prices disable trigger trg_sync_price_dozen;
update public.product_prices pr set price_retail = v.r, price_dozen = v.d, price_wholesale = v.w
  from (values ${prices.join(',\n  ')}) v(id, r, d, w) where pr.product_id = v.id;
alter table public.product_prices enable trigger trg_sync_price_dozen;

insert into public.stock_movements (product_id, type, singles_qty) values ${stock.join(',\n  ')};

-- مناطق زاد: ثلاث فقط (والاستلام من المحل وبقية المناطق بلا zad_zone_id فلا تظهر للزبون)
update public.delivery_zones set zad_zone_id = 'dev-' || id where name in ('الرمادي — داخل المدينة', 'الفلوجة', 'بغداد');

update public.app_settings set value = '' where key in ('telegram_bot_token', 'telegram_chat_id');
update public.app_settings set value = 'on' where key = 'reseller_orders_enabled';

-- ثلاثة متاجر: فعّال بشعار، فعّال بلون فاتح بلا شعار، وموقوف
insert into public.reseller_stores (owner_id, slug, name, logo_path, theme_color, phone, whatsapp, about, status, markup_type, markup_value, round_to) values
  ('${OWNER}', 'noor-store', 'متجر النور', '${OWNER}/logo.svg', '#0f766e', '9647700000001', '9647700000002',
   'عطور وعناية ومستلزمات منزلية بأسعار مناسبة، نوصّل لكل مناطق بغداد والأنبار.', 'active', 'percent', 30, 250),
  ('${users[1][0]}', 'sunny-corner', 'الركن المشمس', null, '#facc15', '9647700000003', null, null, 'active', 'fixed', 2000, 500),
  ('${users[2][0]}', 'paused-shop', 'متجر الأمل', null, '#2563eb', '9647700000004', null, null, 'suspended', 'percent', 20, 250),
  ('${users[3][0]}', 'review-shop', 'متجر قيد المراجعة', null, '#be123c', '9647700000005', null, null, 'pending', 'percent', 20, 250);
insert into public.reseller_categories (store_id, category_id)
  select s.id, c from public.reseller_stores s, unnest(array[9101, 9102, 9103]) c;

-- مالك «متجر النور» يدخل بتيليغرام برقم 111 (محاكي التطوير). كل من عداه يبدأ من المعالج.
-- كما ينشئه 023: أعمدة لا يقبل GoTrue فراغها، وعلامة المروّج التي يشترطها الدخول
update auth.users set instance_id = '00000000-0000-0000-0000-000000000000', confirmation_token = '', recovery_token = '', email_change = '', email_change_token_new = '',
  raw_app_meta_data = '{"provider":"email","providers":["email"],"reseller_tg":"111"}', raw_user_meta_data = '{}', updated_at = now() where id = '${OWNER}';
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  values ('${OWNER}', '${OWNER}', jsonb_build_object('sub', '${OWNER}', 'email', 'tg111@telegram.invalid'), 'email', now(), now());
insert into public.reseller_identities (telegram_id, user_id, name, phone) values (111, '${OWNER}', 'صاحب متجر النور', '9647700000001');
update public.app_settings set value = '0' where key = 'reseller_hold_days';   -- التجربة: الربح يصير متاحاً فور التسليم

-- ثلاثة طلبات حقيقية عبر الدالة العلنية: اثنان يُسلَّمان (ربح متاح) وواحد جديد
do $$ declare c jsonb; begin
  set local role anon;
  perform public.reseller_create_order('noor-store', 'سارة كريم', '07711000001', jsonb_build_array(jsonb_build_object('product_id', md5('dev-p1')::uuid, 'qty', 2)), 1);
  perform public.reseller_create_order('noor-store', 'أحمد علي', '07711000002', jsonb_build_array(jsonb_build_object('product_id', md5('dev-p10')::uuid, 'qty', 12), jsonb_build_object('product_id', md5('dev-p8')::uuid, 'qty', 3)), 4);
  perform public.reseller_create_order('noor-store', 'زبون جديد', '07711000003', jsonb_build_array(jsonb_build_object('product_id', md5('dev-p5')::uuid, 'qty', 1)), 12, 'قرب المدرسة');
end $$;
reset role;
update public.orders set status = 'delivered' where customer_phone in ('07711000001', '07711000002');

-- منتجات «متجر النور» الخاصة (يوصلها بنفسه): اثنان مقبولان وواحد بانتظار المراجعة
update public.reseller_stores set own_delivery_fee = 2000 where slug = 'noor-store';
insert into public.reseller_own_products (store_id, name, description, price, image_path, status)
select s.id, v.n, v.d, v.p, v.i, v.st from public.reseller_stores s, (values
  ('شمعة معطّرة يدوية الصنع', 'شمع صويا طبيعي برائحة العود، تدوم 40 ساعة.', 8000, '${OWNER}/own1.svg', 'approved'),
  ('صابون بالعسل والشوفان', 'قطعة 120 غرام، مصنوعة يدوياً.', 3500, '${OWNER}/own2.svg', 'approved'),
  ('مبخرة خشبية', null, 15000, null, 'pending')) v(n, d, p, i, st)
 where s.slug = 'noor-store';
`
}
