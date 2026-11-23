// فحص متاجر المروّجين (مسودات 015–020) على قاعدة محلية معزولة:
//   node scripts/check-reseller.mjs              كل شيء
//   node scripts/check-reseller.mjs --fast       بلا كسر الحرّاس (mutations)؛ --races كسر الأقفال والتطابق فقط
//   PRODUCTS=ملف.json node scripts/check-reseller.mjs   منتجات حقيقية لفحوص التطابق:
//     [{sold_by,pack_only,pack_qty,wholesale_min,price_retail,price_wholesale,price_dozen,stock}]
import { readFileSync } from 'node:fs'
import { start, stop, psql, session as open, must, errOf, read, migration } from './local-db.mjs'
import { MUTATIONS, RACE_MUTATIONS } from './reseller-mutations.mjs'

const DRAFTS = ['015_close_public_signup', '016_rifai_line', '017_reseller_schema', '018_reseller_orders', '019_reseller_money', '020_reseller_reports', '021_reseller_login']
const test = read('supabase/reseller-test.sql')
const one = (sql) => must('query', psql(sql))
const ok = (cond, label) => { if (!cond) throw new Error('فشل: ' + label); console.log('✔ ' + label); passed++ }
let passed = 0, code = 0
let errs = []                                   // أخطاء آخر سباق: لنعرف لماذا سقط، لا أنه سقط فقط
const session = async (sql) => { const r = await open(sql); const e = r.stderr.match(/ERROR: .*/); if (e) errs.push(e[0].slice(7, 90)); return r }
const only = process.argv.includes('--fast')

// ---------- منتجات التطابق: شبكة تركيبية + (اختياري) الفعلية ----------
const grid = []
for (const [sold_by, pack_only] of [['dozen', false], ['dozen', true], ['piece', false]])
  for (const pack_qty of [12, 24, 25]) for (const wholesale_min of sold_by === 'piece' ? [1, 2, 6] : [1])
    for (const [price_retail, dozen] of [[1000, 9000], [1000, 0], [0, 9000], [0, 0], [500, 60000], [3333, 10000]])
      grid.push({ sold_by, pack_only, pack_qty, wholesale_min, price_retail, price_dozen: dozen, stock: 1000 })
const real = process.env.PRODUCTS ? JSON.parse(readFileSync(process.env.PRODUCTS, 'utf8')) : []
const seedProducts = (rows) => `
insert into public.products (name, category_id, sold_by, pack_only, pack_qty, wholesale_min)
select 'تطابق ' || r.n, (select min(id) from public.categories), r.j->>'sold_by', (r.j->>'pack_only')::boolean, (r.j->>'pack_qty')::int, (r.j->>'wholesale_min')::int
  from jsonb_array_elements('${JSON.stringify(rows)}'::jsonb) with ordinality r(j, n);
alter table public.product_prices disable trigger trg_sync_price_dozen;
update public.product_prices pr set price_retail = (r.j->>'price_retail')::bigint, price_dozen = (r.j->>'price_dozen')::bigint,
       price_wholesale = coalesce((r.j->>'price_wholesale')::bigint, round((r.j->>'price_dozen')::numeric / (r.j->>'pack_qty')::int))
  from jsonb_array_elements('${JSON.stringify(rows)}'::jsonb) with ordinality r(j, n), public.products p
 where p.name = 'تطابق ' || r.n and pr.product_id = p.id;
alter table public.product_prices enable trigger trg_sync_price_dozen;
update public.products p set quantity_single = (r.j->>'stock')::int
  from jsonb_array_elements('${JSON.stringify(rows)}'::jsonb) with ordinality r(j, n) where p.name = 'تطابق ' || r.n;
insert into public.delivery_zones (name, fee, zad_zone_id) values ('منطقة تطابق', 1500, 'z-eq') on conflict do nothing;`

// نداء يُلغى أثره: النتيجة أو نص الخطأ
const TRY = `
create function pg_temp.try_order(p_fn text, p_id uuid, p_qty int, p_mode text) returns text language plpgsql as $$
declare r jsonb; v text;
begin
  begin
    execute format('select public.%I(''زبون'', ''07701234567'', %L::jsonb, %L, %s, null)', p_fn, jsonb_build_array(jsonb_build_object('product_id', p_id, 'qty', p_qty)), p_mode,
      (select id from public.delivery_zones where name = 'منطقة تطابق')) into r;
    raise exception using errcode = 'RB000', message = (r - 'order_id' - 'order_number')::text;
  exception when sqlstate 'RB000' then return sqlerrm; when others then return 'ERR ' || sqlerrm; end;
end $$;`
const QTYS = 'array[1,2,3,5,6,11,12,13,24,25,36,50,60,100,300,1000,1001,0,-1]'

// ---------- بصمة الرفاعي والمنى: تُحسب قبل المسودات وبعدها ----------
const FINGERPRINT = `
begin;
set local client_min_messages = warning;
select setval('public.order_number_seq', 700000);
create function pg_temp.u(k text) returns uuid language sql as $$ select md5(k)::uuid $$;
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at) select pg_temp.u(k), 'authenticated', 'authenticated', k || '@fp.test', now(), now() from unnest(array['admin','sup','mona']) k;
update public.profiles set is_active = true, role = case id when pg_temp.u('admin') then 'admin' when pg_temp.u('mona') then 'mona_admin' else 'data_entry' end::public.user_role where id in (pg_temp.u('admin'), pg_temp.u('sup'), pg_temp.u('mona'));
insert into public.categories (id, name) values (9001, 'ب'), (9002, 'ب منى'); update public.categories set store = 'mona' where id = 9002;
insert into public.products (id, name, category_id, code, sold_by, pack_qty, wholesale_min, pack_only, store) values
 (pg_temp.u('p1'), 'بند1', 9001, 'FP0001', 'dozen', 12, 1, false, 'rifai'), (pg_temp.u('p2'), 'بند2', 9001, 'FP0002', 'piece', 12, 2, false, 'rifai'),
 (pg_temp.u('p3'), 'بند3', 9001, 'FP0003', 'dozen', 24, 1, true, 'rifai'), (pg_temp.u('p4'), 'بند4', 9002, 'FP0004', 'dozen', 12, 1, false, 'mona'), (pg_temp.u('p5'), 'بند5', 9001, 'FP0005', 'dozen', 12, 1, false, 'rifai');
update public.product_prices set price_retail = 3000, price_dozen = 24000 where product_id = pg_temp.u('p1');
update public.product_prices set price_retail = 10000, price_dozen = 102000 where product_id = pg_temp.u('p2');
update public.product_prices set price_dozen = 5000 where product_id = pg_temp.u('p3');
update public.product_prices set price_retail = 4000 where product_id = pg_temp.u('p4');
insert into public.stock_movements (product_id, type, singles_qty) select pg_temp.u(k), 'stock_in', 500 from unnest(array['p1','p2','p3','p4','p5']) k;
insert into public.delivery_zones (id, name, fee, zad_zone_id) values (9001, 'منطقة بصمة', 3000, 'zfp');
insert into public.app_settings (key, value) values ('telegram_bot_token', 'T'), ('telegram_chat_id', '1') on conflict (key) do update set value = excluded.value;
delete from net.http_request_queue;
create temp table r (n serial, v text); grant all on r to public; grant usage on sequence r_n_seq to public;
create function pg_temp.call(p text) returns void language plpgsql as $$
declare v text; begin
  begin execute p into v; exception when others then v := 'ERR ' || sqlerrm; end;
  insert into r (v) values (regexp_replace(coalesce(v, 'null'), '"order_id": ?"[^"]+",? ?', ''));
end $$;
create function pg_temp.items(variadic a text[]) returns text language sql as $$
  select quote_literal(jsonb_agg(jsonb_build_object('product_id', pg_temp.u(split_part(x, ':', 1)), 'qty', split_part(x, ':', 2)::int))::text) || '::jsonb' from unnest(a) x $$;
select pg_temp.call(format('select public.create_order(''زبون'', ''07701234567'', %s, %L, 9001, ''ملاحظة'')', i, m))
  from (values (pg_temp.items('p1:3', 'p2:1')), (pg_temp.items('p2:2', 'p3:24')), (pg_temp.items('p1:24')), (pg_temp.items('p3:5')), (pg_temp.items('p5:1')), (pg_temp.items('p4:1')), (pg_temp.items('p1:900'))) a(i), (values ('retail'), ('wholesale'), ('x')) b(m);
select pg_temp.call(format('select public.mona_create_order(''زبونة'', ''07701234567'', %s, 9001)', i)) from (values (pg_temp.items('p1:3', 'p4:2')), (pg_temp.items('p3:1')), (pg_temp.items('p4:900'))) a(i);
insert into public.orders (customer_name, customer_phone, mode, subtotal, total_amount, items_json, source, payment, delivery_zone) values ('آجل', '—', 'retail', 7000, 7000, '[{"name":"فاتورة","qty":1,"line_total":7000,"price_on_request":false}]', 'pos', 'debt', 'محل');
update public.orders set status = 'confirmed' where order_number = 700001;
update public.orders set status = 'delivered' where order_number in (700001, 700002);
update public.orders set status = 'cancelled' where order_number = 700003;
update public.orders set status = 'new' where order_number = 700003;
update public.orders set status = 'cancelled' where order_number = 700004;
do $$ declare who text; begin
  foreach who in array array['admin', 'sup', 'mona', 'none'] loop
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.u(who))::text, true);
    perform set_config('role', 'authenticated', true);
    perform pg_temp.call('select ''' || who || ' '' || public.finance_summary(current_date - 1, current_date + 1)::text');
    perform pg_temp.call('select string_agg(t::text, '';'') from public.top_products(current_date - 1, current_date + 1, 50) t');
    perform pg_temp.call('select string_agg(t.name || t.quantity_single, '';'' order by t.name) from public.low_stock(500) t where t.name like ''بند%''');
    perform pg_temp.call('select count(*) || ''/'' || coalesce(sum(subtotal), 0) from public.orders');
    perform pg_temp.call('with u as (update public.orders set status = ''confirmed'' where order_number = 700005 returning 1) select count(*)::text from u');
    perform pg_temp.call('select public.price_order_item((select id from public.orders where order_number = 700001), pg_temp.u(''p1''), 2500, false)::text');
    perform pg_temp.call('select count(*) || ''/'' || coalesce(sum(mona_price), 0) from public.mona_admin_products where name like ''بند%''');
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
  end loop; end $$;
select pg_temp.call('select string_agg(qty_sold::text, '','' order by product_id) from public.popular_products');
select pg_temp.call('select string_agg(qty_sold::text, '','' order by product_id) from public.mona_popular_products');
select pg_temp.call('select string_agg(s::text, '';'' order by code) from public.storefront_products s where name like ''بند%''');
select pg_temp.call('select string_agg((to_jsonb(s))::text, '';'' order by code) from public.mona_storefront_products s where name like ''بند%''');
select pg_temp.call('select string_agg(name || quantity_single, '','' order by name) from public.products where name like ''بند%''');
select public.send_daily_sales_report();
select pg_temp.call('select string_agg(convert_from(body, ''UTF8''), E''\\n'' order by id) from net.http_request_queue');
select regexp_replace(v, '[0-9a-f]{8}-[0-9a-f-]{27}|20\\d\\d-\\d\\d-\\d\\d[ T]?[0-9:.+]*', '#', 'g') from r order by n;
rollback;`

// ---------- السباقات: بيانات مُثبَّتة، وجلستان حقيقيتان ----------
const RACE_SETUP = `
insert into auth.users (id, aud, role, email, email_confirmed_at, created_at) select md5(k)::uuid, 'authenticated', 'authenticated', k || '@race.test', now(), now() from unnest(array['radmin','rowner']) k on conflict do nothing;
update public.profiles set role = 'admin', is_active = true where id = md5('radmin')::uuid;
update public.app_settings set value = 'on' where key = 'reseller_orders_enabled';
update public.app_settings set value = '0' where key = 'reseller_hold_days';
insert into public.categories (id, name) values (9100, 'سباق');
insert into public.products (id, name, category_id) select md5(k)::uuid, k, 9100 from unnest(array['r1','r2','r3','rlast']) k;
update public.product_prices set price_retail = 1000 where product_id in (select id from public.products where category_id = 9100);
insert into public.stock_movements (product_id, type, singles_qty) select id, 'stock_in', case name when 'rlast' then 1 else 900 end from public.products where category_id = 9100;
insert into public.delivery_zones (id, name, fee, zad_zone_id) values (9100, 'منطقة سباق', 1000, 'zr');
insert into public.reseller_stores (id, owner_id, slug, name, phone, status, markup_type, markup_value, round_to) values (md5('rstore')::uuid, md5('rowner')::uuid, 'race-store', 'سباق', '9647700000000', 'active', 'fixed', 13000, 1);
insert into public.reseller_categories values (md5('rstore')::uuid, 9100);`
const STORE = `md5('rstore')::uuid`
const as = (who) => `select set_config('request.jwt.claims', json_build_object('role','authenticated','sub', md5('${who}')::uuid)::text, false); set role authenticated;`
const buySql = (items, phone) => `select public.reseller_create_order('race-store', 'زبون', '${phone}', '${JSON.stringify(items)}'::jsonb, 9100)->>'order_number';`
const pid = (k) => one(`select md5('${k}')::uuid`)
let phoneN = 0
const phone = () => '0781' + String(1000000 + ++phoneN)
const age = () => one(`update public.orders set created_at = created_at - interval '2 hours' where source = 'reseller'`)
const buy = (k, qty = 1) => { age(); return one(buySql([{ product_id: pid(k), qty }], phone())) }
const status = (no, s) => `update public.orders set status = '${s}' where order_number = ${no};`
const ledger = () => one(`select coalesce(string_agg(kind || ':' || amount, ',' order by id), '') from public.reseller_ledger where store_id = ${STORE}`)
const reset = () => must('reset', psql(`
  alter table public.reseller_ledger disable trigger user; delete from public.reseller_ledger; alter table public.reseller_ledger enable trigger user;
  delete from public.reseller_payouts; delete from public.reseller_payout_accounts where false;
  update public.orders set status = 'cancelled' where source = 'reseller' and status <> 'cancelled';
  alter table public.reseller_ledger disable trigger user; delete from public.reseller_ledger; alter table public.reseller_ledger enable trigger user; delete from public.reseller_payouts;
  update public.reseller_stores set status = 'active' where id = ${STORE};`))
const noDeadlock = (rs) => rs.every((r) => !/deadlock/i.test(r.stderr))

const RACES = {
  async 'آخر قطعة: طلبان متزامنان ينجح واحد'() {
    const last = pid('rlast')
    age()
    one(`update public.products set quantity_single = 1 where id = '${last}'`)
    // الأول يمسك معاملته ثانيتين بعد الطلب
    const a = session(`begin; ${buySql([{ product_id: last, qty: 1 }], phone())} select pg_sleep(2); commit;`)
    const b = session(`select pg_sleep(0.7); ${buySql([{ product_id: last, qty: 1 }], phone())}`)
    const rs = await Promise.all([a, b])
    return rs.filter((r) => r.status === 0).length === 1 && /غير متوفرة/.test(rs.map((r) => r.stderr).join()) &&
      one(`select quantity_single from public.products where id = '${last}'`) === '0'
  },
  async 'سلّتان بترتيب معكوس: لا تشابك'() {
    const [x, y] = ['r1', 'r2'].map(pid)
    age()
    const jobs = []
    for (let i = 0; i < 12; i++) jobs.push(session(buySql(i % 2 ? [{ product_id: x, qty: 1 }, { product_id: y, qty: 1 }] : [{ product_id: y, qty: 1 }, { product_id: x, qty: 1 }], phone())))
    const rs = await Promise.all(jobs)
    return noDeadlock(rs) && rs.every((r) => r.status === 0)
  },
  async 'طلب جديد مع عملية تمسك المتجر ثم المنتج: لا تشابك'() {
    reset(); const no = buy('r3'); const p = pid('r3'); age()
    const a = session(`begin; select (public.reseller_lock(${STORE})).slug; select pg_sleep(2); ${status(no, 'cancelled')} commit;`)
    const b = session(`select pg_sleep(0.7); begin; ${buySql([{ product_id: p, qty: 1 }], phone())} select pg_sleep(0.1); commit;`)
    const rs = await Promise.all([a, b])
    return noDeadlock(rs) && rs.every((r) => r.status === 0)
  },
  async 'تسليمان متزامنان يبلغان العتبة: طلب تلقائي واحد'() {
    reset(); const n1 = buy('r1'), n2 = buy('r2')
    const a = session(`begin; ${status(n1, 'delivered')} select pg_sleep(1.5); commit;`)
    const b = session(`select pg_sleep(0.5); ${status(n2, 'delivered')}`)
    const rs = await Promise.all([a, b])
    return rs.every((r) => r.status === 0) &&
      one(`select count(*) || '/' || sum(amount) from public.reseller_payouts where store_id = ${STORE}`) === '1/26000'
  },
  async 'طلبا استلام يدويان متزامنان: واحد'() {
    reset(); one(status(buy('r1'), 'delivered'))
    const go = `${as('rowner')} select public.reseller_request_payout();`
    const rs = await Promise.all([session(`begin; ${go} select pg_sleep(1.5); commit;`), session(`select pg_sleep(0.5); ${go}`), session(`select pg_sleep(0.6); ${go}`)])
    return rs.filter((r) => r.status === 0).length === 1 && one(`select count(*) from public.reseller_payouts where store_id = ${STORE} and status = 'open'`) === '1'
  },
  async 'الفحص الدوري مع الطلب اليدوي: واحد'() {
    reset(); one(`update public.app_settings set value = '1000' where key = 'reseller_payout_threshold'; update public.app_settings set value = '0' where key = 'reseller_payout_threshold'`)
    one(status(buy('r1'), 'delivered')); one(`update public.app_settings set value = '10000' where key = 'reseller_payout_threshold'`)
    const rs = await Promise.all([session(`begin; select public.reseller_auto_payouts(); select pg_sleep(1.5); commit;`), session(`select pg_sleep(0.5); ${as('rowner')} select public.reseller_request_payout();`)])
    one(`update public.app_settings set value = '25000' where key = 'reseller_payout_threshold'`)
    return /مفتوح/.test(rs[1].stderr) && one(`select count(*) from public.reseller_payouts where store_id = ${STORE}`) === '1'
  },
  async 'الدفع أولاً ثم الإلغاء: رصيد سالب ولا قيد يضيع'() {
    reset(); const no = buy('r1', 1); one(status(no, 'delivered')); one(`${as('rowner')} select public.reseller_request_payout();`)
    const p = one(`select id from public.reseller_payouts where status = 'open'`)
    const rs = await Promise.all([session(`begin; ${as('radmin')} select public.reseller_payout_paid('${p}', 'REF'); select pg_sleep(1.5); commit;`), session(`select pg_sleep(0.5); ${status(no, 'cancelled')}`)])
    return rs.every((r) => r.status === 0) && ledger() === 'profit_due:13000,payout:-13000,reversal:-13000' && one(`select public.reseller_available(${STORE})`) === '-13000'
  },
  async 'الإلغاء أولاً ثم الدفع: الدفع يُرفض'() {
    reset(); const no = buy('r1', 1); one(status(no, 'delivered')); one(`${as('rowner')} select public.reseller_request_payout();`)
    const p = one(`select id from public.reseller_payouts where status = 'open'`)
    const rs = await Promise.all([session(`begin; ${status(no, 'cancelled')} select pg_sleep(1.5); commit;`), session(`select pg_sleep(0.5); ${as('radmin')} select public.reseller_payout_paid('${p}', 'REF');`)])
    return rs[0].status === 0 && /تغيّر المستحق/.test(rs[1].stderr) && ledger() === 'profit_due:13000,reversal:-13000'
  },
  async 'مديران يضغطان «تم التحويل» معاً: قيد واحد'() {
    reset(); one(status(buy('r1', 1), 'delivered')); one(`${as('rowner')} select public.reseller_request_payout();`)
    const p = one(`select id from public.reseller_payouts where status = 'open'`)
    const go = `${as('radmin')} select public.reseller_payout_paid('${p}', 'REF');`
    const rs = await Promise.all([session(`begin; ${go} select pg_sleep(1.5); commit;`), session(`select pg_sleep(0.5); ${go}`)])
    return rs.filter((r) => r.status === 0).length === 1 && /عولج سابقاً/.test(rs[1].stderr) && ledger() === 'profit_due:13000,payout:-13000'
  },
  async 'المروّج يلغي والمدير يدفع معاً: واحد منهما'() {
    reset(); one(status(buy('r1', 1), 'delivered')); one(`${as('rowner')} select public.reseller_request_payout();`)
    const p = one(`select id from public.reseller_payouts where status = 'open'`)
    const rs = await Promise.all([session(`begin; ${as('rowner')} select public.reseller_cancel_payout('${p}'); select pg_sleep(1.5); commit;`), session(`select pg_sleep(0.5); ${as('radmin')} select public.reseller_payout_paid('${p}', 'REF');`)])
    return rs[0].status === 0 && /عولج سابقاً/.test(rs[1].stderr) && ledger() === 'profit_due:13000'
  },
  async 'تفعيل ورفض متزامنان لمتجر: الأول فقط'() {
    one(`update public.reseller_stores set status = 'pending' where id = ${STORE}`)
    const rs = await Promise.all([session(`begin; ${as('radmin')} select public.reseller_decide_store(${STORE}, 'activate'); select pg_sleep(1.5); commit;`), session(`select pg_sleep(0.5); ${as('radmin')} select public.reseller_decide_store(${STORE}, 'reject', 'سبب');`)])
    const ok = /عولج سابقاً/.test(rs[1].stderr) && one(`select status from public.reseller_stores where id = ${STORE}`) === 'active'
    one(`update public.reseller_stores set status = 'active' where id = ${STORE}`)
    return ok
  },
  async 'ستة طلبات متزامنة من هاتف واحد: خمسة فقط'() {
    age(); const x = pid('r1'); const ph = phone()
    const rs = await Promise.all(Array.from({ length: 6 }, () => session(`begin; ${buySql([{ product_id: x, qty: 1 }], ph)} select pg_sleep(0.3); commit;`)))
    return rs.filter((r) => r.status === 0).length === 5
  },
}

// التطابق: مئات المنتجات × الكميات × الوضعين × العرض
let said = ''
const CHECKS = {
  'create_order القديمة = الجديدة'() {
    const out = ['off', 'on'].map((promo) => one(`update public.app_settings set value = '${promo}' where key = 'promo_wholesale_all'; ${TRY}
      select count(*) || '|' || count(*) filter (where a = b) || '|' || count(*) filter (where a not like 'ERR%') || '|' || count(distinct id)
        from (select p.id, pg_temp.try_order('create_order_old', p.id, q, m) a, pg_temp.try_order('create_order', p.id, q, m) b
                from public.products p, unnest(${QTYS}) q, unnest(array['retail','wholesale']) m where p.store = 'rifai' and p.name like 'تطابق%') x`).split('|'))
    said = out.map((d, i) => `العرض ${['off', 'on'][i]}: ${d[1]}/${d[0]} نداء متطابق، ${d[2]} منها ناجح، ${d[3]} منتج`).join(' · ')
    return out.every((d) => d[0] === d[1] && +d[2] > 1000)
  },
  // لكل منتج وكمية يقبلها متجر الرفاعي: أساس المروّج = المبلغ نفسه. وغير المعروض سعر وحدته 0 فقط.
  'أساس المروّج = سعر الرفاعي'() {
    const out = []
    for (const promo of ['off', 'on']) for (const mode of ['retail', 'wholesale']) out.push(one(`
      update public.app_settings set value = '${promo}' where key = 'promo_wholesale_all'; update public.app_settings set value = '${mode}' where key = 'reseller_base'; ${TRY}
      select count(*) || '|' || count(*) filter (where bad) || '|' || count(distinct id) || '|' || count(distinct id) filter (where base is null and q = 1) from (
        select p.id, q, r, l.base_total base,
               case when r like 'ERR%' then false
                    when l.product_id is null then case when p.pack_only or ('${mode}' = 'wholesale' and p.sold_by <> 'piece') then pr.price_dozen
                      else public.rifai_price(pr.price_wholesale, pr.price_retail, '${mode}', '${promo}' = 'on') end > 0
                    else l.base_total is distinct from (r::jsonb->>'subtotal')::bigint or l.sell_total < l.base_total end bad
          from public.products p join public.product_prices pr on pr.product_id = p.id cross join unnest(array[1,2,3,6,12,24,25,36,50,60,100]) q
          cross join lateral pg_temp.try_order('create_order', p.id, q, '${mode}') r
          left join lateral public.reseller_lines(${STORE}, p.id, q) l on true
         where p.name like 'تطابق%' and p.quantity_single >= q) x`).split('|'))
    one(`update public.app_settings set value = 'off' where key = 'promo_wholesale_all'; update public.app_settings set value = 'retail' where key = 'reseller_base'`)
    said = `${out.map((d) => d[0]).join('+')} بنداً على ${out[0][2]} منتج، خلاف: ${out.map((d) => d[1]).join('+')}`
    return out.every((d) => d[1] === '0' && +d[0] > 500)
  },
}

const apply = (swap = {}) => DRAFTS.map((d) => swap[d] ?? migration(d)).join('\n')

try {
  start()
  console.log('✔ بُنيت القاعدة المحلية من ملفات المستودع (حتى 014)')
  if (process.env.FP_OUT) console.log(must('بصمة', psql(FINGERPRINT)))
  if (process.env.MD5_OUT) console.log(one(`select string_agg(proname || ' ' || md5(replace(pg_get_functiondef(p.oid), E'\\r', '')), E'\\n' order by 1) from pg_proc p where pronamespace = 'public'::regnamespace and proname in ('create_order','finance_summary','top_products','send_daily_sales_report','notify_new_order','price_order_item','restore_stock_on_status','apply_stock_movement','mona_create_order','mona_price','zad_dispatch','zad_label','zad_poll','rifai_price','orders_supervisor_guard')`))

  // أ) بصمة قبل
  const before = must('بصمة قبل', psql(FINGERPRINT))
  must('منتجات التطابق', psql(seedProducts([...grid, ...real])))
  must('نسخة create_order القديمة', psql(`do $$ begin execute replace(pg_get_functiondef('public.create_order'::regproc), 'public.create_order(', 'public.create_order_old('); end $$;`))

  // ب) المسودات + الفحوص داخل معاملة تُلغى
  const run = (sql) => psql(`begin;\n${sql}\n${test}\nrollback;\n\\echo ALL-OK`)
  const t = run(apply())
  if (t.status !== 0) throw new Error(errOf(t))
  const n = (t.stderr.match(/✔ /g) ?? []).length
  if (process.argv.includes('-v')) console.log((t.stderr.match(/✔ .*/g) ?? []).join('\n'))
  passed += n
  console.log(`✔ فحوص القاعدة: ${n}`)

  // ج) كسر الحرّاس واحداً واحداً
  if (!only && !process.argv.includes('--races')) {
    const weak = []
    for (const [label, file, find, repl, expect, also] of MUTATIONS) {
      // also: كسر ثانٍ لازم ليُختبر الأول وحده (فهرس فريد ومعه on conflict الذي يعتمد عليه)
      const cuts = [[file, find, repl], ...(also ? [also] : [])]
      const times = cuts.every(([f, a]) => migration(f).split(a).length === 2) ? 1 : 0
      const r = times === 1 ? run(apply(Object.fromEntries(cuts.map(([f, a, b]) => [f, migration(f).replace(a, () => b)])))) : { status: 0, stderr: '', stdout: '' }
      const why = (r.stderr.match(/ERROR: .*/) ?? [times === 1 ? 'نجح الفحص!' : 'النص ليس موجوداً مرة واحدة'])[0]
      // يجب أن يسقط الفحص المعنيّ بعينه، لا أي فحص
      const good = r.status !== 0 && expect && why.includes('فشل: ' + expect)
      if (good) passed++; else weak.push(label)
      console.log(`${good ? '✔ كُسر فكُشف' : '✘ لم يُكشف كما يجب'}: ${label} ← ${good ? expect : why.slice(0, 150)}`)
    }
    if (weak.length) throw new Error(`${weak.length} حارساً بلا فحص يخصّه`)
  }

  // د) تطبيق فعلي مثل db.mjs (كل ملف في معاملة) ثم البصمة والتطابق
  for (const d of DRAFTS) must(d, psql(migration(d), { tx: true }))
  ok(true, 'المسودات 015–020 طُبِّقت كلٌّ في معاملة بدور postgres')
  const after = must('بصمة بعد', psql(FINGERPRINT))
  if (after !== before) {
    const a = after.split('\n'), b = before.split('\n'); const i = b.findIndex((l, k) => l !== a[k])
    throw new Error(`فشل: الرفاعي/المنى تغيّرا\nقبل: ${b[i]}\nبعد: ${a[i]}`)
  }
  // البصمة ليست فارغة: طلبات ناجحة فعلاً، ومبيعات في التقارير، ولا خطأ غير أخطاء الحراسة المتوقعة
  const made = before.split('\n').filter((l) => /"order_number"/.test(l)).length
  ok(made >= 8 && /admin .*"sales_goods": [1-9]\d{4}/.test(before) && /طلب المنى #/.test(before) && /بضاعة: \d{2},/.test(before)
    && !/ERR (column|function|relation|permission|الرجاء)/.test(before), `البصمة غير فارغة (${made} طلباً ناجحاً)`)
  ok(before.split('\n').length > 60, `طلبات الرفاعي والمنى وتقاريرهما مطابقة حرفياً قبل/بعد (${before.split('\n').length} سطراً)`)

  must('متجر التطابق', psql(RACE_SETUP))
  one(`insert into public.reseller_categories select ${STORE}, (select min(id) from public.categories) on conflict do nothing`)
  CHECKS['بصمة الرفاعي والمنى'] = () => must('بصمة', psql(FINGERPRINT)) === before
  for (const label of ['create_order القديمة = الجديدة', 'أساس المروّج = سعر الرفاعي']) ok(CHECKS[label](), `${label} — ${said}`)

  // هـ) السباقات
  one(`insert into public.reseller_payout_accounts (store_id, method, account_no, holder_name) values (${STORE}, 'zaincash', '07700000000', 'اسم')`)
  for (const [label, fn] of Object.entries(RACES)) ok(await fn(), 'سباق — ' + label)

  // و) كسر الأقفال والتطابق والتقارير على القاعدة المُثبَّتة
  if (!only) for (const [label, file, find, repl, race] of RACE_MUTATIONS) {
    const src = migration(file)
    if (src.split(find).length !== 2) throw new Error(`كسر «${label}»: النص غير موجود مرة واحدة`)
    const fnOf = (s) => { const i = s.indexOf(find) >= 0 ? s.indexOf(find) : s.indexOf(repl); const a = s.lastIndexOf('create or replace function', i); return s.slice(a, s.indexOf('$$;', i) + 3) }
    const good = fnOf(src)
    must('كسر', psql(good.replace(find, () => repl)))
    errs = []; said = ''
    const caught = !(await (RACES[race] ?? CHECKS[race])())      // استثناء هنا عطلٌ في الفحص لا كشف
    must('إصلاح', psql(good))
    one(`update public.app_settings set value = '25000' where key = 'reseller_payout_threshold'`)
    ok(caught, `كُسر فكُشف: ${label} ← ${race} [${errs.join(' / ') || said || 'نتيجة خاطئة بلا خطأ'}]`)
  }
  console.log(`✅ نجح الكل: ${passed}`)
} catch (e) {
  console.error('✘ ' + e.message)
  code = 1
} finally {
  stop()
}
process.exit(code)
