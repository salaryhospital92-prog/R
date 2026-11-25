-- =====================================================================
-- فحص متاجر المروّجين — محلياً فقط عبر: node scripts/check-reseller.mjs
-- المشغّل يلفّه بـ begin … rollback بعد تطبيق المسودات. لا تشغّله على الحيّ.
-- =====================================================================

-- ---------- أدوات ----------
create temp table fx (k text primary key, v uuid);
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.want(p_ok boolean, p_name text) returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'فشل: %', p_name; end if; raise notice '✔ %', p_name; end $$;
create function pg_temp.eq(p_got anyelement, p_want anyelement, p_name text) returns void language plpgsql as $$
begin if p_got is distinct from p_want then raise exception 'فشل: % (كان % والمتوقع %)', p_name, p_got, p_want; end if; raise notice '✔ %', p_name; end $$;
create function pg_temp.fails(p_sql text, p_pat text, p_name text) returns void language plpgsql as $$
declare e text;
begin
  begin execute p_sql; e := null; exception when others then e := sqlerrm; end;
  if e is null then raise exception 'فشل: % — نجح وكان يجب أن يُرفض', p_name; end if;
  if e !~ p_pat then raise exception 'فشل: % — رُفض لسبب آخر: %', p_name, e; end if;
  raise notice '✔ %', p_name;
end $$;
-- يجب أن ينجح
create function pg_temp.runs(p_sql text, p_name text) returns void language plpgsql as $$
begin
  execute p_sql; raise notice '✔ %', p_name;
exception when others then raise exception 'فشل: % — %', p_name, sqlerrm;
end $$;
create function pg_temp.as_(p_role text, p_user uuid default null) returns void language plpgsql as $$
begin
  perform set_config('role', case p_role when 'owner' then 'none' else p_role end, true);
  perform set_config('request.jwt.claims', case when p_role = 'owner' then '' else
    json_strip_nulls(json_build_object('role', p_role, 'sub', p_user))::text end, true);
end $$;
create function pg_temp.out() returns void language sql as $$ select pg_temp.as_('owner') $$;
create function pg_temp.mk_user(p_key text, p_role text default null) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email, created_at) values (u, 'authenticated', 'authenticated', p_key || '@example.test', now());
  update auth.users set email_confirmed_at = now() where id = u;
  if p_role is not null then update public.profiles set role = p_role::public.user_role, is_active = true where id = u; end if;
  insert into fx values (p_key, u);
  return u;
end $$;
create function pg_temp.mk_product(p_key text, p_cat int, p_retail bigint, p_stock int, p_sold text default 'dozen', p_dozen bigint default 0,
                                   p_pack int default 12, p_min int default 1, p_packonly boolean default false, p_store text default 'rifai') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.products (name, category_id, sold_by, pack_qty, wholesale_min, pack_only, store, barcode)
  values ('منتج ' || p_key, p_cat, p_sold, p_pack, p_min, p_packonly, p_store, 'BC' || p_key) returning id into v;
  update public.product_prices set price_retail = p_retail, price_dozen = p_dozen where product_id = v;
  insert into public.stock_movements (product_id, type, singles_qty) values (v, 'stock_in', p_stock);
  insert into fx values (p_key, v);
  return v;
end $$;
create function pg_temp.item(p_key text, p_qty int) returns jsonb language sql as $$ select jsonb_build_object('product_id', pg_temp.f(p_key), 'qty', p_qty) $$;
-- طلب زبون (anon) ← معرّف الطلب
create function pg_temp.buy(p_slug text, p_items jsonb, p_phone text default null) returns uuid language plpgsql as $$
declare r jsonb; n int;
begin
  update public.orders set created_at = created_at - interval '2 hours' where source = 'reseller' and created_at > now() - interval '1 hour';
  perform pg_temp.as_('anon');
  r := public.reseller_create_order(p_slug, 'زبون', coalesce(p_phone, '0770' || lpad((random() * 9999999)::int::text, 7, '0')),
         case when jsonb_typeof(p_items) = 'array' then p_items else jsonb_build_array(p_items) end,
         (select id from public.delivery_zones where name = 'منطقة فحص زاد'));
  perform pg_temp.out();
  return (select id from public.orders where order_number = (r->>'order_number')::bigint);
end $$;
create function pg_temp.st(p_order uuid, p_status text) returns void language sql as $$
  update public.orders set status = p_status::public.order_status where id = p_order $$;
create function pg_temp.bal(p_owner text, p_key text) returns bigint language plpgsql as $$
declare r bigint;
begin
  perform pg_temp.as_('authenticated', pg_temp.f(p_owner));
  r := (public.reseller_balance()->>p_key)::bigint;
  perform pg_temp.out(); return r;
end $$;
-- ساعة الاختبار: ينقل استحقاق كل القيود (المالك وحده يعطّل زناد الثبات)
create function pg_temp.mature(p_store uuid, p_at timestamptz default now()) returns void language plpgsql as $$
begin
  alter table public.reseller_ledger disable trigger trg_reseller_ledger_immutable;
  update public.reseller_ledger set available_at = p_at where store_id = p_store and available_at > p_at;
  alter table public.reseller_ledger enable trigger trg_reseller_ledger_immutable;
end $$;
create function pg_temp.cfg(p_key text, p_val text) returns void language sql as $$ update public.app_settings set value = p_val where key = p_key $$;
create function pg_temp.mk_store(p_key text, p_slug text, p_json jsonb default '{}') returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_('authenticated', pg_temp.f(p_key));
  v := public.reseller_save_store(jsonb_build_object('slug', p_slug, 'name', 'متجر ' || p_slug, 'phone', '07701112233',
         'markup_type', 'fixed', 'markup_value', 3000, 'round_to', 1) || p_json);
  insert into public.reseller_categories (store_id, category_id) select v, id from public.categories where name = 'صنف فحص';
  perform pg_temp.out();
  insert into fx values (p_key || '.store', v);
  return v;
end $$;
create function pg_temp.activate(p_key text) returns void language plpgsql as $$
begin
  perform pg_temp.as_('authenticated', pg_temp.f(p_key)); perform public.reseller_submit_store();
  perform pg_temp.as_('authenticated', pg_temp.f('admin')); perform public.reseller_decide_store(pg_temp.f(p_key || '.store'), 'activate');
  perform pg_temp.out();
end $$;
create function pg_temp.account(p_key text) returns void language plpgsql as $$
begin
  perform pg_temp.as_('authenticated', pg_temp.f(p_key));
  perform public.reseller_save_payout_account('zaincash', '07709998877', 'صاحب الحساب');
  perform pg_temp.out();
end $$;
create function pg_temp.open_payout(p_key text) returns uuid language sql as $$
  select id from public.reseller_payouts where store_id = pg_temp.f(p_key || '.store') and status = 'open' $$;

-- ---------- بيانات ----------
do $$
declare c int; c2 int;
begin
  perform pg_temp.cfg('reseller_orders_enabled', 'on');
  perform pg_temp.mk_user('admin', 'admin');  perform pg_temp.mk_user('sup', 'data_entry'); perform pg_temp.mk_user('mona', 'mona_admin');
  perform pg_temp.mk_user('A'); perform pg_temp.mk_user('B'); perform pg_temp.mk_user('C'); perform pg_temp.mk_user('N');
  insert into public.categories (name) values ('صنف فحص') returning id into c;
  insert into public.categories (name) values ('صنف آخر') returning id into c2;
  insert into public.delivery_zones (name, fee, zad_zone_id) values ('منطقة فحص زاد', 2000, 'z-test'), ('استلام فحص', 0, null);
  perform pg_temp.mk_product('P', c, 7000, 500);
  perform pg_temp.mk_product('T', c, 10000, 500, 'piece', 102000, 12, 2);            -- جملة من قطعتين: 8500
  perform pg_temp.mk_product('K', c, 0, 500, 'dozen', 1500, 12, 1, true);            -- علبة فقط
  perform pg_temp.mk_product('Z', c, 0, 500, 'dozen', 6000);                         -- أساسه 0 مفرداً
  perform pg_temp.mk_product('H', c, 5000, 500);  update public.products set reseller_hidden = true where id = pg_temp.f('H');
  perform pg_temp.mk_product('X', c, 5000, 500);  update public.products set is_active = false where id = pg_temp.f('X');
  perform pg_temp.mk_product('M', c, 5000, 500, p_store => 'mona');
  perform pg_temp.mk_product('O', c2, 5000, 500);                                    -- صنف لم يختره المتجر
  perform pg_temp.mk_product('S', c, 1000, 1);                                       -- قطعة واحدة
  perform pg_temp.mk_product('G', c, 9000, 500);
  insert into public.telegram_agents (telegram_id, agent_name, role, is_active) values (901, 'مدير', 'admin', true), (902, 'موقوف', 'admin', false), (903, 'مشرف', 'data_entry', true);
  perform pg_temp.mk_store('A', 'store-a'); perform pg_temp.mk_store('B', 'store-b'); perform pg_temp.mk_store('C', 'store-c');
  perform pg_temp.activate('A'); perform pg_temp.activate('B');
end $$;

-- ---------- 1) مثال القبول ----------
do $$
declare o uuid; r public.orders; f0 jsonb; f1 jsonb; t0 bigint; t1 bigint; sent jsonb; s0 int;
begin
  f0 := public.finance_summary(current_date, current_date);
  t0 := coalesce((select revenue from public.top_products(current_date, current_date, 1000) where name = 'منتج P'), 0);
  s0 := (select quantity_single from public.products where id = pg_temp.f('P'));
  o := pg_temp.buy('store-a', pg_temp.item('P', 1)); insert into fx values ('o1', o);
  select * into r from public.orders where id = o;
  perform pg_temp.eq(r.subtotal, 10000::bigint, '1أ subtotal=10000');
  perform pg_temp.eq(r.total_amount, 12000::bigint, '1ب total=12000');
  perform pg_temp.eq(r.source || r.mode || r.payment, 'resellerretailcash', '1ج المصدر والوضع');
  perform pg_temp.eq((select profit from public.reseller_orders where order_id = o), 3000::bigint, '1د الربح 3000');
  perform pg_temp.eq((select quantity_single from public.products where id = pg_temp.f('P')), s0 - 1, '1هـ المخزون نقص مرة واحدة');
  perform pg_temp.eq(pg_temp.bal('A', 'pending'), 3000::bigint, '1و معلّق 3000');
  perform pg_temp.eq(pg_temp.bal('A', 'held') + pg_temp.bal('A', 'available'), 0::bigint, '1ز لا مستحق قبل التسليم');

  -- زاد: بديل محلي لـzad_req يعيد ما أُرسل (لا شبكة أصلاً)
  create or replace function public.zad_req(p_method text, p_path text, p_body jsonb default null, p_idem text default null) returns jsonb language plpgsql as $s$
  begin
    if p_method = 'POST' then perform set_config('t.zad', p_body::text, true); end if;
    return jsonb_build_object('status', 200, 'body', jsonb_build_object('id', 'zid', 'summon_number', '1', 'mode', 'test',
      'status', case when p_method = 'POST' then 'searching' else 'delivered' end)); end $s$;
  perform public.zad_set('dispatch', 'on');
  perform pg_temp.as_('authenticated', pg_temp.f('sup'));
  update public.orders set status = 'confirmed' where id = o;                  -- المشرف يؤكّد ويستدعي كاليوم
  perform public.zad_dispatch(o);
  perform pg_temp.out();
  sent := current_setting('t.zad')::jsonb;
  perform pg_temp.eq((sent->>'cash_to_collect_iqd')::bigint, 10000::bigint, '1ح المرسل لزاد 10000');
  perform pg_temp.want(sent::text !~ 'store-a|rifai|رفاعي', '1ط حمولة زاد بلا اسم متجر ولا رفاعي');
  perform public.zad_poll();
  perform pg_temp.eq((select status::text from public.orders where id = o), 'delivered', '1ي zad_poll يسلّم الطلب');
  perform pg_temp.eq(pg_temp.bal('A', 'held'), 3000::bigint, '1ك بعد التسليم: في المهلة 3000');
  perform pg_temp.eq(pg_temp.bal('A', 'available'), 0::bigint, '1ل غير متاح قبل انتهاء المهلة');

  f1 := public.finance_summary(current_date, current_date);
  t1 := (select revenue from public.top_products(current_date, current_date, 1000) where name = 'منتج P');
  perform pg_temp.eq((f1->>'sales_goods')::bigint - (f0->>'sales_goods')::bigint, 7000::bigint, '1م مبيعات الرفاعي الصافية +7000');
  perform pg_temp.eq((f1->>'sales_total')::bigint - (f0->>'sales_total')::bigint, 9000::bigint, '1ن إجمالي الرفاعي +9000 (بضاعة + توصيل)');
  perform pg_temp.eq((f1->>'sales_cash')::bigint - (f0->>'sales_cash')::bigint, 9000::bigint, '1س النقد +9000');
  perform pg_temp.eq(t1 - t0, 7000::bigint, '1ع top_products بالأساس');
  -- المدير يرى الرقم نفسه تحت RLS
  perform pg_temp.as_('authenticated', pg_temp.f('admin'));
  f1 := public.finance_summary(current_date, current_date);
  perform pg_temp.out();
  perform pg_temp.eq((f1->>'sales_goods')::bigint - (f0->>'sales_goods')::bigint, 7000::bigint, '1ف ومن حساب المدير (RLS) +7000');
end $$;

-- ---------- 2) مهلة الاستحقاق ----------
do $$
declare s uuid := pg_temp.f('A.store');
begin
  perform pg_temp.eq((select available_at - created_at from public.reseller_ledger where order_id = pg_temp.f('o1')), interval '3 days', '2أ المهلة 3 أيام من التسليم');
  perform pg_temp.account('A');
  perform pg_temp.as_('authenticated', pg_temp.f('A'));
  perform pg_temp.fails('select public.reseller_request_payout()', 'لا رصيد متاح', '2ب الطلب اليدوي ممنوع داخل المهلة');
  perform pg_temp.out();
  perform pg_temp.mature(s, now() + interval '1 microsecond');
  perform pg_temp.eq(pg_temp.bal('A', 'available'), 0::bigint, '2ج قبل الحدّ بميكروثانية: غير متاح');
  perform pg_temp.mature(s, now());
  perform pg_temp.eq(pg_temp.bal('A', 'available'), 3000::bigint, '2د عند الحدّ تماماً: متاح');
  perform pg_temp.eq(pg_temp.bal('A', 'held'), 0::bigint, '2هـ ولم يعد في المهلة');
  perform pg_temp.cfg('reseller_hold_days', '0');
  perform pg_temp.st(pg_temp.buy('store-b', pg_temp.item('P', 1)), 'delivered');
  perform pg_temp.eq(pg_temp.bal('B', 'available'), 3000::bigint, '2و مهلة 0: متاح فوراً');
  perform pg_temp.cfg('reseller_hold_days', 'تالف');
  insert into fx values ('o2', pg_temp.buy('store-b', pg_temp.item('P', 1)));
  perform pg_temp.st(pg_temp.f('o2'), 'delivered');
  perform pg_temp.eq(pg_temp.bal('B', 'held'), 3000::bigint, '2ز إعداد تالف ⇒ 3 أيام لا 0');
  perform pg_temp.cfg('reseller_hold_days', '3');
  perform pg_temp.eq(pg_temp.bal('B', 'available'), 3000::bigint, '2ح تغيير الإعداد لا يحرّك قيداً سابقاً');
end $$;

-- ---------- 3) الطلب التلقائي والحجز والإلغاء ----------
do $$
declare s uuid := pg_temp.f('A.store'); p uuid; n int;
begin
  -- المتاح الآن 3000. نصعد إلى 24,999 ثم 25,000
  perform pg_temp.as_('authenticated', pg_temp.f('admin'));
  perform public.reseller_adjust(s, 21999, 'تسوية فحص');
  perform pg_temp.out();
  perform pg_temp.want(pg_temp.open_payout('A') is null, '3أ عند 24,999 لا طلب تلقائياً');
  perform pg_temp.as_('authenticated', pg_temp.f('admin'));
  perform public.reseller_adjust(s, 1, 'تسوية فحص');
  perform pg_temp.out();
  p := pg_temp.open_payout('A');
  perform pg_temp.eq((select amount || origin from public.reseller_payouts where id = p), '25000auto', '3ب عند 25,000 طلب تلقائي بالمبلغ');
  perform pg_temp.eq(pg_temp.bal('A', 'available'), 0::bigint, '3ج المبلغ محجوز');
  perform pg_temp.eq(pg_temp.bal('A', 'reserved'), 25000::bigint, '3د ويظهر محجوزاً');

  -- تكرار التلقائي
  perform public.reseller_auto_payouts(); perform public.reseller_auto_payouts();
  perform public.reseller_auto_payout(s, true);
  perform pg_temp.eq((select count(*)::int from public.reseller_payouts where store_id = s), 1, '3هـ التكرار لا ينشئ ثانياً');
  perform pg_temp.as_('authenticated', pg_temp.f('A'));
  perform pg_temp.fails('select public.reseller_request_payout()', 'مفتوح', '3و لا طلب يدوي مع مفتوح');
  perform pg_temp.out();
  perform pg_temp.fails(format('insert into public.reseller_payouts (store_id, account_id, amount, origin) select store_id, account_id, 1, ''manual'' from public.reseller_payouts where id = %L', p),
    'one_open', '3ز والفهرس يمنعه ولو من المالك');

  -- الإلغاء يعيد المبلغ، ولا يعود وحده بنفس المبلغ
  perform pg_temp.as_('authenticated', pg_temp.f('A')); perform public.reseller_cancel_payout(p);
  perform pg_temp.fails(format('select public.reseller_cancel_payout(%L)', p), 'عولج', '3ح لا إلغاء مرتين');
  perform pg_temp.out();
  perform pg_temp.eq(pg_temp.bal('A', 'available'), 25000::bigint, '3ط الإلغاء يعيد المبلغ');
  perform public.reseller_auto_payouts();
  perform pg_temp.want(pg_temp.open_payout('A') is null, '3ي الملغى لا يُعاد تلقائياً بنفس المبلغ');
  perform pg_temp.as_('authenticated', pg_temp.f('admin')); perform public.reseller_adjust(s, 500, 'زيادة'); perform pg_temp.out();
  p := pg_temp.open_payout('A');
  perform pg_temp.eq((select amount from public.reseller_payouts where id = p), 25500::bigint, '3ك وإن زاد المتاح عاد');

  -- الرفض ثم تغيير الحساب
  perform pg_temp.as_('authenticated', pg_temp.f('admin'));
  perform pg_temp.fails(format('select public.reseller_payout_reject(%L, '''')', p), 'السبب', '3ل الرفض يلزمه سبب');
  perform public.reseller_payout_reject(p, 'الحساب خطأ');
  perform pg_temp.out();
  perform public.reseller_auto_payouts();
  perform pg_temp.want(pg_temp.open_payout('A') is null, '3م المرفوض لا يعود وحده');
  perform pg_temp.as_('authenticated', pg_temp.f('A'));
  perform public.reseller_save_payout_account('zaincash', '07709998877', 'صاحب الحساب');
  perform pg_temp.out();
  perform pg_temp.want(pg_temp.open_payout('A') is null, '3ن حفظ نفس الحساب ليس تغييراً');
  perform pg_temp.as_('authenticated', pg_temp.f('A'));
  perform public.reseller_save_payout_account('qicard', '123456789', 'صاحب الحساب');
  perform pg_temp.out();
  perform pg_temp.eq((select a.method from public.reseller_payouts x join public.reseller_payout_accounts a on a.id = x.account_id where x.id = pg_temp.open_payout('A')),
    'qicard', '3س وتغيير الحساب يعيد الطلب على الحساب الجديد');

  -- بلا حساب لا ينشأ، وعند حفظه ينشأ
  perform pg_temp.as_('authenticated', pg_temp.f('admin')); perform public.reseller_adjust(pg_temp.f('B.store'), 30000, 'تسوية'); perform pg_temp.out();
  perform pg_temp.want(pg_temp.open_payout('B') is null, '3ع بلا حساب استلام لا طلب تلقائياً');
  perform pg_temp.as_('authenticated', pg_temp.f('B'));
  perform pg_temp.fails('select public.reseller_request_payout()', 'حساب الاستلام', '3ف واليدوي يطلب الحساب');
  perform pg_temp.out();
  perform pg_temp.account('B');
  perform pg_temp.eq((select amount from public.reseller_payouts where id = pg_temp.open_payout('B')), 33000::bigint, '3ص ينشأ عند حفظ الحساب');
end $$;

-- المهلة تحكم التلقائي أيضاً
do $$
declare s uuid; o uuid;
begin
  perform pg_temp.mk_user('D'); s := pg_temp.mk_store('D', 'store-d', '{"markup_value": 25000}'); perform pg_temp.activate('D'); perform pg_temp.account('D');
  o := pg_temp.buy('store-d', pg_temp.item('P', 1)); insert into fx values ('od', o);
  perform pg_temp.st(o, 'delivered');
  perform public.reseller_auto_payouts();
  perform pg_temp.want(pg_temp.open_payout('D') is null, '3ق ربح 25,000 داخل المهلة: لا تلقائي');
  perform pg_temp.mature(s, now() + interval '1 microsecond'); perform public.reseller_auto_payouts();
  perform pg_temp.want(pg_temp.open_payout('D') is null, '3ر قبل الحدّ بميكروثانية: لا تلقائي');
  perform pg_temp.mature(s); perform public.reseller_auto_payouts();
  perform pg_temp.eq((select amount from public.reseller_payouts where id = pg_temp.open_payout('D')), 25000::bigint, '3ش عند الحدّ: الفحص الدوري ينشئه');
  perform pg_temp.want(exists (select 1 from cron.job where jobname = 'reseller-auto-payouts' and active), '3ت الفحص الدوري مجدوَل');
end $$;

-- ---------- 4) الدفع والعكس ----------
do $$
declare s uuid := pg_temp.f('D.store'); o uuid := pg_temp.f('od'); p uuid := pg_temp.open_payout('D'); n int;
begin
  perform pg_temp.as_('authenticated', pg_temp.f('admin'));
  perform pg_temp.fails(format('select public.reseller_payout_paid(%L, '' '')', p), 'مرجع', '4أ الدفع يلزمه مرجع');
  perform public.reseller_payout_paid(p, 'REF-1');
  perform pg_temp.fails(format('select public.reseller_payout_paid(%L, ''REF-2'')', p), 'عولج سابقاً', '4ب لا دفع مرتين');
  perform pg_temp.out();
  perform pg_temp.eq(pg_temp.bal('D', 'paid'), 25000::bigint, '4ج المدفوع 25,000');
  perform pg_temp.eq(pg_temp.bal('D', 'available'), 0::bigint, '4د الرصيد صفر');

  -- عكس بعد الدفع: سالب، ولا قيد يضيع
  perform pg_temp.st(o, 'cancelled');
  perform pg_temp.eq(pg_temp.bal('D', 'available'), -25000::bigint, '4هـ إلغاء بعد الدفع ⇒ رصيد سالب');
  perform pg_temp.eq((select string_agg(kind || ':' || amount, ',' order by id) from public.reseller_ledger where store_id = s),
    'profit_due:25000,payout:-25000,reversal:-25000', '4و القيود الثلاثة باقية');
  perform pg_temp.as_('authenticated', pg_temp.f('D'));
  perform pg_temp.fails('select public.reseller_request_payout()', 'لا رصيد', '4ز لا طلب برصيد سالب');
  perform pg_temp.out();

  -- إعادة التسليم: دورة ثانية تعيد الربح مرة واحدة، والمخزون صحيح
  n := (select quantity_single from public.products where id = pg_temp.f('P'));
  perform pg_temp.st(o, 'confirmed');
  perform pg_temp.eq((select quantity_single from public.products where id = pg_temp.f('P')), n - 1, '4ح إعادة التفعيل تخصم المخزون');
  perform pg_temp.runs(format('select pg_temp.st(%L, ''delivered'')', o), '4ط0 إعادة التسليم');
  perform pg_temp.eq((select string_agg(kind || cycle, ',' order by id) from public.reseller_ledger where order_id = o),
    'profit_due1,reversal1,profit_due2', '4ط تسليم ← إلغاء ← تسليم: دورتان');
  perform pg_temp.eq((select sum(amount)::bigint from public.reseller_ledger where order_id = o), 25000::bigint, '4ي صافي الطلب ربح واحد');
  perform pg_temp.eq((select cycle from public.reseller_ledger where order_id = o and kind = 'profit_due' and available_at > now()), 2, '4ك الدورة الثانية تبدأ مهلة جديدة');

  -- إعادة إطلاق نفس الحالة لا تكرر
  perform pg_temp.st(o, 'delivered'); update public.orders set status = status where id = o;
  perform pg_temp.eq((select count(*)::int from public.reseller_ledger where order_id = o), 3, '4ل إعادة الحالة نفسها بلا قيد');
  perform pg_temp.fails(format('insert into public.reseller_ledger (store_id, kind, amount, order_id, cycle) values (%L, ''profit_due'', 1, %L, 2)', s, o), 'order_once', '4م والفهرس يمنع التكرار');
  perform pg_temp.fails(format('insert into public.reseller_ledger (store_id, kind, amount, payout_id) values (%L, ''payout'', -1, %L)', s, p), 'payout_once', '4م2 ولا قيدَي دفع لطلب واحد');

  -- مُسلَّم ضُغطت خطأً ثم أُعيدت «مؤكد»: تُعكس وهي في المهلة فلا أثر في أي وقت
  perform pg_temp.st(o, 'confirmed');
  perform pg_temp.eq((select sum(amount)::bigint from public.reseller_ledger where order_id = o), 0::bigint, '4ن التراجع عن التسليم يعكس');
  perform pg_temp.eq(pg_temp.bal('D', 'held'), 0::bigint, '4س ولا يبقى في المهلة شيء');
  perform pg_temp.eq(pg_temp.bal('D', 'available'), -25000::bigint, '4ع ولا ينقص المتاح مرتين');
end $$;

-- إلغاء والطلب مفتوح: لا يُدفع أكثر من المستحق
do $$
declare o uuid; p uuid;
begin
  perform pg_temp.mk_user('E'); perform pg_temp.mk_store('E', 'store-e', '{"markup_value": 26000}'); perform pg_temp.activate('E'); perform pg_temp.account('E');
  perform pg_temp.cfg('reseller_hold_days', '0');
  o := pg_temp.buy('store-e', pg_temp.item('P', 1)); perform pg_temp.st(o, 'delivered');
  perform pg_temp.cfg('reseller_hold_days', '3');
  p := pg_temp.open_payout('E');
  perform pg_temp.want(p is not null, '4ف طلب تلقائي عند التسليم بمهلة 0');
  perform pg_temp.st(o, 'cancelled');
  perform pg_temp.as_('authenticated', pg_temp.f('admin'));
  perform pg_temp.fails(format('select public.reseller_payout_paid(%L, ''REF-9'')', p), 'تغيّر المستحق', '4ص لا دفع بعد أن زال المستحق');
  perform pg_temp.fails(format('select public.reseller_adjust(%L, 0, ''سبب'')', pg_temp.f('E.store')), 'مبلغ', '4ق تسوية صفر مرفوضة');
  perform public.reseller_payout_reject(p, 'أُلغي الطلب');
  perform pg_temp.out();
  perform pg_temp.eq(pg_temp.bal('E', 'available'), 0::bigint, '4ر الرفض يحرّر والرصيد صفر');
  -- فشل التسليم: الطلب يبقى مؤكداً فلا ربح ولا غرامة
  o := pg_temp.buy('store-e', pg_temp.item('P', 1)); perform pg_temp.st(o, 'confirmed'); perform pg_temp.st(o, 'cancelled');
  perform pg_temp.eq((select count(*)::int from public.reseller_ledger where order_id = o), 0, '4ش رفض الزبون: لا ربح ولا غرامة');
end $$;

-- ---------- 5) اللقطة ----------
do $$
declare o uuid; a jsonb; b jsonb;
begin
  o := pg_temp.buy('store-b', jsonb_build_array(pg_temp.item('P', 2), pg_temp.item('T', 3), pg_temp.item('K', 24)));
  select to_jsonb(ro) || jsonb_build_object('i', (select jsonb_agg(to_jsonb(i) order by line_no) from public.reseller_order_items i where i.order_id = o)) into a from public.reseller_orders ro where order_id = o;
  update public.product_prices set price_retail = price_retail * 3 + 1, price_dozen = price_dozen * 2 where product_id in (pg_temp.f('P'), pg_temp.f('T'), pg_temp.f('K'));
  perform pg_temp.cfg('promo_wholesale_all', 'on'); perform pg_temp.cfg('reseller_base', 'wholesale');
  perform pg_temp.as_('authenticated', pg_temp.f('B')); perform public.reseller_save_store('{"markup_value": 1}'); perform pg_temp.out();
  update public.products set is_active = false where id = pg_temp.f('T');
  select to_jsonb(ro) || jsonb_build_object('i', (select jsonb_agg(to_jsonb(i) order by line_no) from public.reseller_order_items i where i.order_id = o)) into b from public.reseller_orders ro where order_id = o;
  perform pg_temp.eq(b, a, '5أ تغيّر السعر والزيادة والعرض والأساس لا يمسّ لقطة الطلب');
  perform pg_temp.st(o, 'delivered');
  perform pg_temp.eq((select amount from public.reseller_ledger where order_id = o), (a->>'profit')::bigint, '5ب والربح المقيَّد هو لقطته');
  perform pg_temp.fails(format('update public.reseller_orders set base_subtotal = 1 where order_id = %L', o), 'لا يُعدَّل', '5ج اللقطة لا تُعدَّل');
  perform pg_temp.fails(format('update public.reseller_order_items set base_total = 1 where order_id = %L', o), 'لا يُعدَّل', '5د ولا بنودها');
  update public.products set is_active = true where id = pg_temp.f('T');
  update public.product_prices set price_retail = 7000, price_dozen = 0 where product_id = pg_temp.f('P');
  update public.product_prices set price_retail = 10000, price_dozen = 102000 where product_id = pg_temp.f('T');
  update public.product_prices set price_retail = 0, price_dozen = 1500 where product_id = pg_temp.f('K');
  perform pg_temp.cfg('promo_wholesale_all', 'off'); perform pg_temp.cfg('reseller_base', 'retail');
  perform pg_temp.as_('authenticated', pg_temp.f('B')); perform public.reseller_save_store('{"markup_value": 3000}'); perform pg_temp.out();
end $$;

-- ---------- 6) الحرّاس ----------
do $$
declare o uuid := pg_temp.buy('store-a', pg_temp.item('P', 1)); z uuid; t text;
begin
  perform pg_temp.as_('authenticated', pg_temp.f('admin'));
  perform pg_temp.fails(format('select public.price_order_item(%L, %L, 1, false)', o, pg_temp.f('P')), 'لا تُعدَّل', '6أ تسعير بند طلب المروّج ممنوع');
  perform pg_temp.fails(format('update public.orders set discount = 500, total_amount = total_amount - 500 where id = %L', o), 'لا تُعدَّل', '6ب الخصم ممنوع');
  perform pg_temp.fails(format('update public.orders set discount = 500 where id = %L', o), 'لا تُعدَّل', '6ب2 ولا الخصم وحده');
  perform pg_temp.fails(format('update public.orders set subtotal = 1, total_amount = 1 + delivery_fee where id = %L', o), 'لا تُعدَّل', '6ج subtotal ممنوع');
  perform pg_temp.fails(format('update public.orders set total_amount = 1 where id = %L', o), 'لا تُعدَّل', '6د المجموع لا يخالف البنود');
  perform pg_temp.fails(format('update public.orders set source = ''storefront'', reseller_store_id = null where id = %L', o), 'لا تُعدَّل', '6هـ لا ينتقل إلى الرفاعي');
  update public.orders set delivery_fee = 2500, total_amount = subtotal + 2500 where id = o;
  perform pg_temp.want(true, '6و أجرة التوصيل تُعدَّل');
  perform pg_temp.out();
  insert into public.orders (customer_name, customer_phone, total_amount, items_json) values ('x', '1', 0, '[]') returning id into z;
  perform pg_temp.fails(format('update public.orders set source = ''reseller'', reseller_store_id = %L where id = %L', pg_temp.f('A.store'), z), 'لا تُعدَّل', '6ز طلب رفاعي لا يصير طلب مروّج');
  perform pg_temp.fails(format('insert into public.orders (customer_name, customer_phone, total_amount, items_json, source) values (''x'', ''1'', 0, ''[]'', ''reseller'')'), 'reseller_check', '6ح reseller بلا متجر مرفوض');
  foreach t in array array['update public.reseller_ledger set amount = 1', 'delete from public.reseller_ledger', 'truncate public.reseller_ledger',
    'update public.reseller_audit set action = ''x''', 'delete from public.reseller_audit',
    'update public.reseller_payout_accounts set account_no = ''07700000000''', 'delete from public.reseller_payout_accounts'] loop
    perform pg_temp.fails(t, 'لا يُعدَّل', '6ط مالك الجداول نفسه لا يستطيع: ' || t);
  end loop;
  foreach t in array array['insert into public.reseller_ledger (store_id, kind, amount) select id, ''adjustment'', 1 from public.reseller_stores limit 1',
    'update public.reseller_ledger set amount = 1', 'update public.reseller_payouts set status = ''paid'', reference = ''xx''', 'delete from public.reseller_payouts',
    'select * from public.reseller_payout_accounts', 'update public.reseller_orders set cycle = 9'] loop
    perform pg_temp.as_('service_role');
    perform pg_temp.fails(t, 'permission denied', '6ي مفتاح الخدمة لا يستطيع: ' || left(t, 45));
    perform pg_temp.out();
  end loop;
end $$;

-- ---------- 7) معادلة السعر ----------
do $$
begin
  perform pg_temp.eq(public.reseller_price(7000, null, 'fixed', 3000, 1, null), 10000::bigint, '7أ مبلغ ثابت');
  perform pg_temp.eq(public.reseller_price(1000, null, 'percent', 10, 250, null), 1250::bigint, '7ب نسبة وتقريب لأعلى');
  perform pg_temp.eq(public.reseller_price(1000, null, 'percent', 25, 250, null), 1250::bigint, '7ج المضاعف التام لا يُزاد');
  perform pg_temp.eq(public.reseller_price(1000, 1300, 'percent', 25, 250, null), 1300::bigint, '7د السعر الثابت يتقدّم بلا تقريب');
  perform pg_temp.eq(public.reseller_price(1000, 900, 'percent', 25, 250, null), 1000::bigint, '7هـ لا أقل من الأساس');
  perform pg_temp.eq(public.reseller_price(1000, 9000, 'fixed', 0, 250, 50), 1500::bigint, '7و السقف');
  perform pg_temp.eq(public.reseller_price(1000, null, 'fixed', 1, 1000, 0), 1000::bigint, '7ز سقف 0 = الأساس');
  perform pg_temp.want(public.reseller_price(0, 5000, 'fixed', 0, 1, null) is null and public.reseller_price(null, 5000, 'fixed', 0, 1, null) is null, '7ح أساس 0 أو فارغ ⇒ لا سعر ولو بسعر ثابت');
end $$;

-- ---------- 8) ما يُعرض وما يُطلب ----------
do $$
declare v jsonb; o uuid; r jsonb; zone int := (select id from public.delivery_zones where name = 'منطقة فحص زاد'); s text; k text;
begin
  perform pg_temp.as_('anon');
  select jsonb_object_agg(p.name, to_jsonb(p)) into v from public.reseller_store_products('store-a') p;
  perform pg_temp.out();
  perform pg_temp.eq((select string_agg(x, ',' order by x) from jsonb_object_keys(v) x), 'منتج G,منتج K,منتج P,منتج S,منتج T', '8أ يظهر المسموح فقط (لا أساس 0، لا مخفي، لا موقوف، لا منى، لا صنف غير مختار)');
  perform pg_temp.eq((v->'منتج K'->>'price')::bigint || '/' || (v->'منتج K'->>'pack_qty') || '/' || (v->'منتج K'->>'min_qty'), '4500/12/12', '8ب العلبة تُسعَّر علبةً');
  perform pg_temp.eq((v->'منتج P'->>'max_qty')::int, 50, '8ج المخزون الحقيقي محجوب بسقف');
  perform pg_temp.want(v::text !~ '"(base|unit_base|profit|stock|barcode|code|price_wholesale|rifai_name)"' and v::text !~ 'BC' and v::text !~ '[: ](7000|10000)\M.*منتج G', '8د لا أساس ولا ربح ولا باركود في رد الزبون');
  perform pg_temp.eq((v->'منتج P'->>'price')::bigint, 10000::bigint, '8هـ سعر البيع');

  update public.reseller_products set is_visible = true where false;
  perform pg_temp.as_('authenticated', pg_temp.f('A'));
  insert into public.reseller_products (store_id, product_id, is_visible) values (pg_temp.f('A.store'), pg_temp.f('G'), false);
  insert into public.reseller_products (store_id, product_id, price_override, display_name) values (pg_temp.f('A.store'), pg_temp.f('T'), 9000, 'عطر المروّج');
  perform pg_temp.out();
  perform pg_temp.eq((select string_agg(name || ':' || price, ',' order by name) from public.reseller_store_products('store-a') where name ~ 'عطر|G'), 'عطر المروّج:10000', '8و الإخفاء والاسم المخصّص، والثابت تحت الأساس يُرفع إليه');

  -- سعر جملة أعلى من المفرد: البند لا يُباع تحت أساسه
  update public.product_prices set price_retail = 1000, price_dozen = 120000 where product_id = pg_temp.f('T');
  perform pg_temp.eq((select base_total || '/' || sell_total from public.reseller_lines(pg_temp.f('B.store'), pg_temp.f('T'), 2)), '20000/20000', '8و3 البند لا ينزل تحت أساسه');
  update public.product_prices set price_retail = 10000, price_dozen = 102000 where product_id = pg_temp.f('T');

  -- كمية الجملة: الأساس ينزل إلى 8500×2 والبيع يبقى سعر الوحدة؛ والتكرار يُجمع
  o := pg_temp.buy('store-a', jsonb_build_array(pg_temp.item('T', 1), pg_temp.item('T', 1)));
  perform pg_temp.eq((select base_total || '/' || sell_total || '/' || qty from public.reseller_order_items where order_id = o), '17000/20000/2', '8ز كمية الجملة على المجموع المكرّر');
  perform pg_temp.eq((select items_json->0->>'name' from public.orders where id = o), 'منتج T', '8ح التجهيز يرى اسم الرفاعي');
  perform pg_temp.want((select items_json::text !~ 'base|17000|8500' from public.orders where id = o), '8ط لا أساس في items_json');
  perform pg_temp.as_('anon');
  r := public.reseller_create_order('STORE-A', 'زبون', '07712345678', jsonb_build_array(pg_temp.item('T', 1) || '{"unit_price":1,"price":1,"line_total":1}'), zone, 'ملاحظة', 12000);
  perform pg_temp.out();
  perform pg_temp.eq((r->>'subtotal')::bigint, 10000::bigint, '8ي سعر يرسله الزبون يُتجاهل');
  perform pg_temp.want(r->'items'->0->>'name' = 'عطر المروّج' and r::text !~ 'base|profit|barcode|"code"|order_id|BC', '8ك ردّ الطلب باسم المروّج وبلا أسرار');
  update public.orders set created_at = created_at - interval '2 hours' where source = 'reseller';

  perform pg_temp.as_('anon');
  foreach s in array array[
    'store-c|07712345678|P:1|z|المتجر غير متاح|متجر غير مفعّل', 'nope|07712345678|P:1|z|المتجر غير متاح|متجر غير موجود',
    'store-a|0771|P:1|z|هاتف|هاتف ناقص', 'store-a|02012345678|P:1|z|هاتف|هاتف ليس موبايل',
    'store-a|07712345678|P:1|u|منطقة|استلام من المحل ممنوع', 'store-a|07712345678|P:1|0|منطقة|منطقة غير موجودة',
    'store-a|07712345678|K:5|z|علبة كاملة|كسر علبة', 'store-a|07712345678|Z:1|z|لم يعد متوفراً|أساس 0', 'store-a|07712345678|H:1|z|لم يعد متوفراً|مخفي عن المروّجين',
    'store-a|07712345678|X:1|z|لم يعد متوفراً|موقوف', 'store-a|07712345678|M:1|z|لم يعد متوفراً|منتج المنى', 'store-a|07712345678|O:1|z|لم يعد متوفراً|صنف غير مختار',
    'store-a|07712345678|G:1|z|لم يعد متوفراً|أخفاه المروّج', 'store-a|07712345678|S:2|z|غير متوفرة|أكثر من المخزون',
    'store-a|07712345678|P:0|z|كمية|صفر', 'store-a|07712345678|P:-1|z|كمية|سالب', 'store-a|07712345678|P:1001|z|كمية|فوق 1000'] loop
    k := split_part(split_part(s, '|', 3), ':', 1);
    perform pg_temp.fails(format('select public.reseller_create_order(%L, ''زبون'', %L, jsonb_build_array(pg_temp.item(%L, %s)), %s)',
      split_part(s, '|', 1), split_part(s, '|', 2), k, split_part(split_part(s, '|', 3), ':', 2),
      case split_part(s, '|', 4) when 'z' then zone::text when 'u' then (select id::text from public.delivery_zones where name = 'استلام فحص') else '0' end),
      split_part(s, '|', 5), '8ل يُرفض: ' || split_part(s, '|', 6));
  end loop;
  foreach s in array array['[]', '{}', 'null', '[1]', '[{}]', '[{"product_id":"x","qty":1}]', '[{"product_id":null,"qty":1}]', '[{"qty":1}]',
    format('[{"product_id":"%s"}]', pg_temp.f('P')), format('[{"product_id":"%s","qty":1.5}]', pg_temp.f('P')), format('[{"product_id":"%s","qty":1},{"qty":1}]', pg_temp.f('P')),
    format('[{"product_id":"%s","qty":2},{"product_id":"%s","qty":-1}]', pg_temp.f('P'), pg_temp.f('P')), format('[{"product_id":"%s","qty":600},{"product_id":"%s","qty":600}]', pg_temp.f('P'), pg_temp.f('P'))] loop
    perform pg_temp.fails(format('select public.reseller_create_order(''store-a'', ''زبون'', ''07712345678'', %L::jsonb, %s)', s, zone), 'كمية غير صالحة|قائمة المنتجات', '8م حمولة فاسدة: ' || left(s, 40));
  end loop;
  perform pg_temp.fails(format('select public.reseller_create_order(''store-a'', ''زبون'', ''07712345678'', jsonb_build_array(pg_temp.item(''P'', 1)), %s, null, 11999)', zone), 'تغيّر السعر', '8ن المجموع المتوقع خالف');
  perform pg_temp.fails(format('select public.reseller_create_order(''store-a'', ''ز'', ''07712345678'', jsonb_build_array(pg_temp.item(''P'', 1)), %s)', zone), 'اسم', '8س الاسم قصير');
  perform pg_temp.out();
  perform pg_temp.cfg('reseller_orders_enabled', 'off');
  perform pg_temp.as_('anon');
  perform pg_temp.fails(format('select public.reseller_create_order(''store-a'', ''زبون'', ''07712345678'', jsonb_build_array(pg_temp.item(''P'', 1)), %s)', zone), 'متوقف', '8ع قاطع الطوارئ');
  perform pg_temp.want((public.reseller_store('store-a')->>'open')::boolean is false, '8ف والواجهة تعلم');
  perform pg_temp.out();
  perform pg_temp.cfg('reseller_orders_enabled', 'on');

  -- حدّ المعدل (بصيغ مختلفة لنفس الرقم)
  perform pg_temp.as_('anon');
  for i in 1..5 loop
    perform public.reseller_create_order('store-a', 'زبون', case i % 3 when 0 then '07755555555' when 1 then '+9647755555555' else '775 555 5555' end, jsonb_build_array(pg_temp.item('P', 1)), zone);
  end loop;
  perform pg_temp.fails(format('select public.reseller_create_order(''store-b'', ''زبون'', ''07755555555'', jsonb_build_array(pg_temp.item(''P'', 1)), %s)', zone), 'هذا الرقم', '8ص السادس من نفس الهاتف خلال ساعة (ولو من متجر آخر)');
  for i in 1..25 loop
    perform public.reseller_create_order('store-a', 'زبون', '0780' || lpad(i::text, 7, '0'), jsonb_build_array(pg_temp.item('P', 1)), zone);
  end loop;
  perform pg_temp.fails(format('select public.reseller_create_order(''store-a'', ''زبون'', ''07811111111'', jsonb_build_array(pg_temp.item(''P'', 1)), %s)', zone), 'مشغول', '8ق الحادي والثلاثون للمتجر');
  perform pg_temp.out();
  -- المتجر ممتلئ (30): الملغى لا يُعدّ، ومن استلم سابقاً من المتجر يطلب، وغيرهما لا (الحالة تُقلب بلا أزرار ثم تُعاد)
  alter table public.orders disable trigger user;
  update public.orders set status = 'cancelled' where source = 'reseller' and customer_phone = '07800000002';
  alter table public.orders enable trigger user;
  perform pg_temp.as_('anon');
  perform pg_temp.runs(format('select public.reseller_create_order(''store-a'', ''زبون'', ''07822222222'', jsonb_build_array(pg_temp.item(''P'', 1)), %s)', zone), '8ق2 الملغى لا يُعدّ من حدّ المتجر');
  perform pg_temp.fails(format('select public.reseller_create_order(''store-a'', ''زبون'', ''07811111111'', jsonb_build_array(pg_temp.item(''P'', 1)), %s)', zone), 'مشغول', '8ق3 وعاد الحدّ ممتلئاً لغير المستلِمين');
  perform pg_temp.out();
  alter table public.orders disable trigger user;
  update public.orders set status = 'delivered' where source = 'reseller' and customer_phone = '07800000001';
  alter table public.orders enable trigger user;
  perform pg_temp.as_('anon');
  perform pg_temp.runs(format('select public.reseller_create_order(''store-a'', ''زبون'', ''07800000001'', jsonb_build_array(pg_temp.item(''P'', 1)), %s)', zone), '8ق4 من استلم سابقاً يطلب والمتجر ممتلئ');
  perform pg_temp.fails(format('select public.reseller_create_order(''store-a'', ''زبون'', ''07811111111'', jsonb_build_array(pg_temp.item(''P'', 1)), %s)', zone), 'مشغول', '8ق5 وغيره ممنوع');
  perform pg_temp.out();
  alter table public.orders disable trigger user;
  update public.orders set status = 'new' where source = 'reseller' and customer_phone in ('07800000001', '07800000002');
  alter table public.orders enable trigger user;
  update public.orders set created_at = created_at - interval '2 hours' where source = 'reseller';

  -- زبون مسجَّل الدخول بلا صفّ profiles
  delete from public.profiles where id = pg_temp.f('N');
  perform pg_temp.as_('authenticated', pg_temp.f('N'));
  perform pg_temp.runs(format('select public.reseller_create_order(''store-a'', ''زبون'', ''07712345679'', jsonb_build_array(pg_temp.item(''P'', 1)), %s)', zone), '8ر مسجَّل بلا ملف يطلب');
  perform pg_temp.out();

  -- أساس الجملة: علبة، وأقل كمية
  perform pg_temp.cfg('reseller_base', 'wholesale');
  perform pg_temp.eq((select string_agg(name || ':' || price || ':' || min_qty, ',' order by name) from public.reseller_store_products('store-b') where name ~ '[TZP]$'), 'منتج T:11500:2,منتج Z:9000:12', '8ش reseller_base=wholesale يبدّل الأساس (وبلا سعر جملة يختفي)');
  perform pg_temp.cfg('reseller_base', 'retail');
end $$;

-- ---------- 9) دورة المتجر ----------
do $$
declare c uuid := pg_temp.f('C.store'); s text; q text; n int;
begin
  perform pg_temp.as_('authenticated', pg_temp.f('C'));
  foreach s in array array['www', 'admin', 'al-rifaie', 'rifai-shop', 'refai', 'mona', 'a', 'ab', '-abc', 'abc-', 'a--b', 'متجر', 'a b c', 'abc.def', repeat('a', 31)] loop
    perform pg_temp.fails(format('select public.reseller_save_store(jsonb_build_object(''slug'', %L))', s), 'غير صالح أو محجوز', '9أ رابط مرفوض: ' || s);
  end loop;
  perform pg_temp.fails('select public.reseller_save_store(''{"slug":"store-a"}'')', 'مستعمل', '9ب رابط متجر آخر');
  perform pg_temp.fails(format('select public.reseller_save_store(jsonb_build_object(''logo_path'', %L))', pg_temp.f('A') || '/x.png'), 'الشعار', '9ج شعار من مجلد غيره');
  perform pg_temp.fails(format('select public.reseller_save_store(jsonb_build_object(''logo_path'', %L))', pg_temp.f('C') || '/x.svg'), 'الشعار', '9د لا SVG');
  perform pg_temp.fails(format('select public.reseller_save_store(jsonb_build_object(''logo_path'', %L))', pg_temp.f('C') || '/../x.png'), 'الشعار', '9هـ لا تجاوز مسار');
  perform pg_temp.fails('select public.reseller_save_store(''{"theme_color":"red;}"}'')', 'theme_color', '9و لون غير صالح');
  perform pg_temp.fails('select public.reseller_save_store(''{"markup_type":"percent","markup_value":5000}'')', 'check', '9ز نسبة خيالية');
  perform pg_temp.fails('select public.reseller_save_store(''{"markup_value":-1}'')', 'markup_value', '9ح زيادة سالبة');
  perform public.reseller_save_store(jsonb_build_object('logo_path', pg_temp.f('C') || '/logo.png'));
  perform pg_temp.out();

  -- الإشعارات: طابور pg_net محلي بلا شبكة
  update public.app_settings set value = 'TOKEN' where key = 'telegram_bot_token';
  insert into public.app_settings (key, value) values ('telegram_bot_token', 'TOKEN') on conflict (key) do update set value = 'TOKEN';
  delete from net.http_request_queue;
  perform pg_temp.as_('authenticated', pg_temp.f('C')); perform public.reseller_submit_store();
  perform pg_temp.fails('select public.reseller_submit_store()', 'سابقاً', '9ط لا إرسال مرتين');
  perform pg_temp.fails('select public.reseller_save_store(''{"name":"اسم مبدَّل"}'')', 'قيد المراجعة', '9ي لا تبديل للاسم أثناء المراجعة');
  perform public.reseller_save_store('{"markup_value":2500}');
  perform pg_temp.out();
  select string_agg(convert_from(body, 'UTF8'), '') into q from net.http_request_queue;
  perform pg_temp.want(q ~ 'rsok:' and q ~ 'rsno:' and q ~ 'store-c' and q ~ 'logo.png', '9ك إشعار التفعيل فيه الاسم والرابط والشعار والزران');
  perform pg_temp.want((select bool_and(octet_length(m[1]) <= 64) from regexp_matches(q, '"callback_data": ?"([^"]+)"', 'g') m), '9ل callback_data لا يتجاوز 64 بايت');

  -- من يفعّل؟
  foreach s in array array['sup', 'mona', 'A', 'C'] loop
    perform pg_temp.as_('authenticated', pg_temp.f(s));
    perform pg_temp.fails(format('select public.reseller_decide_store(%L, ''activate'', null, 901)', c), 'لمدير الرفاعي', '9م لا يفعّل: ' || s || ' (ولو مرّر رقم مدير)');
  end loop;
  foreach s in array array['902', '903', '999', 'null'] loop
    perform pg_temp.as_('service_role');
    perform pg_temp.fails(format('select public.reseller_decide_store(%L, ''activate'', null, %s)', c, s), 'لمدير الرفاعي', '9ن البوت لا يفعّل برقم: ' || s);
  end loop;
  perform pg_temp.as_('service_role');
  perform pg_temp.eq(public.reseller_decide_store(c, 'activate', null, 901), 'active', '9س البوت يفعّل نيابة عن مدير فعّال');
  perform pg_temp.fails(format('select public.reseller_decide_store(%L, ''activate'', null, 901)', c), 'عولج سابقاً', '9ع لا تفعيل مزدوج');
  perform pg_temp.fails(format('select public.reseller_decide_store(%L, ''reject'', ''سبب'', 901)', c), 'عولج سابقاً', '9ف ولا رفض بعد التفعيل');
  perform pg_temp.out();
  perform pg_temp.eq((select decided_by from public.reseller_stores where id = c), 'tg:901', '9ص يُسجَّل من فعّل');

  -- بعد التفعيل
  delete from net.http_request_queue;
  perform pg_temp.as_('authenticated', pg_temp.f('C'));
  perform pg_temp.fails('select public.reseller_save_store(''{"slug":"new-slug"}'')', 'بعد التفعيل', '9ق الرابط ثابت بعد التفعيل');
  perform public.reseller_save_store('{"name":"اسم جديد للمتجر"}');
  perform pg_temp.out();
  select string_agg(convert_from(body, 'UTF8'), '') into q from net.http_request_queue;
  perform pg_temp.want(q ~ 'غيّر هويته' and q ~ 'اسم جديد للمتجر', '9ر تغيير الاسم يُشعر المديرين');
  delete from net.http_request_queue;
  perform pg_temp.as_('authenticated', pg_temp.f('C')); perform public.reseller_save_store('{"markup_value":2600}'); perform pg_temp.out();
  perform pg_temp.eq((select count(*)::int from net.http_request_queue), 0, '9ش تغيير السعر لا يُشعر');

  -- الإيقاف
  perform pg_temp.as_('authenticated', pg_temp.f('admin'));
  perform pg_temp.fails(format('select public.reseller_decide_store(%L, ''suspend'')', c), 'السبب', '9ت الإيقاف يلزمه سبب');
  perform pg_temp.account('C'); perform pg_temp.as_('authenticated', pg_temp.f('admin'));
  perform public.reseller_decide_store(c, 'suspend', 'مخالفة');
  perform public.reseller_adjust(c, 40000, 'رصيد');
  perform pg_temp.as_('authenticated', pg_temp.f('C'));
  perform pg_temp.fails('select public.reseller_save_store(''{"name":"هههه"}'')', 'موقوف', '9ث الموقوف لا يعدّل');
  perform pg_temp.fails(format('insert into public.reseller_products (store_id, product_id) values (%L, %L)', c, pg_temp.f('P')), 'row-level security', '9خ ولا منتجاته');
  perform pg_temp.fails('select public.reseller_request_payout()', 'غير فعّال', '9ذ ولا يطلب استلاماً');
  perform pg_temp.fails('select public.reseller_save_payout_account(''zaincash'', ''07701234567'', ''س س'')', 'موقوف', '9ض ولا يغيّر حسابه');
  perform pg_temp.eq((select count(*)::int from public.reseller_catalog()), 0, '9ظ ولا كتالوج');
  perform pg_temp.out();
  perform public.reseller_auto_payouts();
  perform pg_temp.want(pg_temp.open_payout('C') is null, '9غ ولا تلقائي، ورصيده محفوظ');
  perform pg_temp.as_('authenticated', pg_temp.f('admin')); perform public.reseller_decide_store(c, 'resume'); perform pg_temp.out();
  perform pg_temp.eq(pg_temp.bal('C', 'reserved'), 40000::bigint, '9غ2 وعند الاستئناف يعود كاملاً وينشأ طلبه');

  -- فشل الإشعار لا يُفشل العملية
  alter table public.telegram_agents rename to telegram_agents_gone;   -- يُسقط دالتي الإشعار
  perform pg_temp.runs('select pg_temp.buy(''store-c'', pg_temp.item(''P'', 1))', '9هـ2 فشل الإشعار لا يُفشل الطلب');
  perform pg_temp.as_('authenticated', pg_temp.f('C'));
  perform pg_temp.runs('select public.reseller_save_store(''{"name":"اسم ثالث"}'')', '9هـ3 ولا الحفظ'); perform pg_temp.out();
  alter table public.telegram_agents_gone rename to telegram_agents;

  -- عنوان إشعار الطلب
  delete from net.http_request_queue;
  perform pg_temp.buy('store-a', pg_temp.item('P', 1));
  select string_agg(convert_from(body, 'UTF8'), '') into q from net.http_request_queue;
  perform pg_temp.want(q ~ 'طلب متجر «متجر store-a»' and q ~ 'منتج P', '9و2 إشعار الطلب باسم المتجر واسم المنتج الحقيقي');
end $$;

-- ---------- 10) حساب الاستلام والسرية ----------
do $$
declare s text; q text; p uuid; r jsonb; n int;
begin
  perform pg_temp.mk_user('F'); perform pg_temp.mk_store('F', 'store-f'); perform pg_temp.activate('F');
  delete from net.http_request_queue;
  perform pg_temp.as_('authenticated', pg_temp.f('F'));
  foreach s in array array['zaincash|0770999887', 'zaincash|08709998877', 'qicard|12345', 'qicard|4111111111111111', 'qicard|4111 1111 1111 1111', 'qicard|٤١١١١١١١١١١١١١١١', 'qicard|4111-1111-1111-1111-123', 'qicard|IQ12ABCD', 'paypal|07709998877', 'zaincash|'] loop
    perform pg_temp.fails(format('select public.reseller_save_payout_account(%L, %L, ''اسم'')', split_part(s, '|', 1), split_part(s, '|', 2)), 'رقم|غير معروفة', '10أ مرفوض: ' || s);
  end loop;
  perform pg_temp.fails('select public.reseller_save_payout_account(''qicard'', ''1234567'', ''4111111111111111'')', 'صاحب الحساب', '10ب رقم بطاقة داخل الاسم مرفوض');
  perform pg_temp.fails('select public.reseller_save_payout_account(''qicard'', ''4111111111111111'', ''اسم'')', 'رقم بطاقة', '10ج رقم البطاقة برسالة واضحة');
  perform public.reseller_save_payout_account('zaincash', '+964 770 123 4567', 'صاحب');
  perform public.reseller_save_payout_account('zaincash', '٠٧٧٠٧٦٥٤٣٢١', 'صاحب');
  perform pg_temp.eq((select string_agg(account_no || is_current, ',' order by seq) from public.reseller_payout_accounts), '07701234567false,07707654321true', '10د التطبيع، والتغيير صفّ جديد والقديم باقٍ');
  perform pg_temp.out();
  perform pg_temp.fails(format('insert into public.reseller_payout_accounts (store_id, method, account_no, holder_name) values (%L, ''qicard'', ''4111111111111111'', ''اسم'')', pg_temp.f('F.store')), 'check', '10هـ والقيد يرفض البطاقة ولو من المالك');
  perform pg_temp.as_('authenticated', pg_temp.f('admin')); perform public.reseller_adjust(pg_temp.f('F.store'), 25000, 'رصيد'); perform pg_temp.out();
  p := pg_temp.open_payout('F');
  select string_agg(convert_from(body, 'UTF8'), '') into q from net.http_request_queue;
  perform pg_temp.want(q ~ '4321' and q ~ 'rpok:' and q !~ '07707654321|07701234567|7654321', '10و تيليغرام مقنّع وفيه زر التحويل');
  perform pg_temp.want(q ~ '72 ساعة', '10ز وتحذير الحساب الجديد');
  perform pg_temp.want(not exists (select 1 from public.reseller_audit where detail ~ '07707654321|07701234567'), '10ح السجل مقنّع');

  foreach s in array array['F', 'A', 'sup', 'mona'] loop
    perform pg_temp.as_('authenticated', pg_temp.f(s));
    perform pg_temp.fails(format('select public.reseller_payout_reveal(%L)', p), 'لمدير الرفاعي', '10ط لا يكشف: ' || s);
  end loop;
  perform pg_temp.as_('service_role'); perform pg_temp.fails(format('select public.reseller_payout_reveal(%L)', p), 'لمدير الرفاعي', '10ي البوت لا يكشف');
  perform pg_temp.as_('authenticated', pg_temp.f('admin'));
  perform pg_temp.eq((select count(*)::int from public.reseller_payout_accounts), 0, '10ك المدير لا يقرأ جدول الحسابات');
  r := public.reseller_payout_reveal(p);
  perform pg_temp.eq(r->>'account_no', '07707654321', '10ل ويكشفه بالدالة');
  perform pg_temp.eq((select count(*)::int from public.reseller_audit where action = 'account_revealed' and detail = p::text), 1, '10م والكشف مسجَّل');
  perform public.reseller_payout_paid(p, 'REF');
  perform pg_temp.fails(format('select public.reseller_payout_reveal(%L)', p), 'غير مفتوح', '10ن لا كشف بعد الإغلاق');
  perform pg_temp.out();

  -- تغيّر الحساب والطلب مفتوح: الطلب باقٍ على حسابه
  perform pg_temp.as_('authenticated', pg_temp.f('admin')); perform public.reseller_adjust(pg_temp.f('F.store'), 25000, 'رصيد');
  perform pg_temp.as_('authenticated', pg_temp.f('F')); perform public.reseller_save_payout_account('zaincash', '07700000001', 'صاحب');
  perform pg_temp.as_('authenticated', pg_temp.f('admin'));
  r := public.reseller_payout_reveal(pg_temp.open_payout('F'));
  perform pg_temp.out();
  perform pg_temp.eq(r->>'account_no', '07707654321', '10س تغيير الحساب لا يحوّل طلباً مفتوحاً');
end $$;

-- ---------- 11) التسرّب: كل جدول وكل دالة ----------
do $$
declare t record; n bigint; m bigint; s text; o uuid; p uuid; anon_fn text[]; auth_fn text[];
begin
  -- أ) الفهرس: المنح بالاسم. أي جدول أو دالة جديدة بلا قرار صريح يُفشل الفحص.
  for t in select c.relname, c.relkind from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'reseller%' and c.relkind in ('r', 'v', 'm') loop
    perform pg_temp.eq(t.relkind::text, 'r', '11أ ليس عرضاً: ' || t.relname);
    perform pg_temp.want((select relrowsecurity from pg_class where oid = ('public.' || t.relname)::regclass), '11ب RLS مفعّل: ' || t.relname);
    perform pg_temp.want(not has_table_privilege('anon', 'public.' || t.relname, 'select, insert, update, delete, truncate, references, trigger')
      and not has_any_column_privilege('anon', 'public.' || t.relname, 'select, insert, update'), '11ج anon بلا أي منحة: ' || t.relname);
  end loop;
  perform pg_temp.eq((select string_agg(c.relname || ':' || concat_ws('', case when has_table_privilege('authenticated', c.oid, 'select') then 'r' end,
      case when has_any_column_privilege('authenticated', c.oid, 'insert') then 'a' end, case when has_any_column_privilege('authenticated', c.oid, 'update') then 'w' end,
      case when has_table_privilege('authenticated', c.oid, 'delete') then 'd' end), ' ' order by c.relname)
     from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'reseller%' and c.relkind = 'r'),
    'reseller_audit:r reseller_categories:rad reseller_identities: reseller_ledger:r reseller_logins: reseller_order_items:r reseller_orders:r reseller_payout_accounts:r reseller_payouts:r reseller_product_requests:raw reseller_products:rawd reseller_secrets: reseller_stores:r reseller_telegram:',
    '11د منح authenticated كما في التصميم');
  perform pg_temp.eq((select string_agg(p.proname, ' ' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'reseller%' or p.proname in ('rifai_line', 'rifai_orders_net')) and has_function_privilege('anon', p.oid, 'execute')),
    'reseller_create_order reseller_store reseller_store_products', '11هـ دوال anon');
  perform pg_temp.eq((select string_agg(p.proname, ' ' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'reseller%' or p.proname in ('rifai_line', 'rifai_orders_net')) and has_function_privilege('authenticated', p.oid, 'execute')),
    'reseller_adjust reseller_balance reseller_can_edit reseller_cancel_payout reseller_catalog reseller_category_list reseller_create_order reseller_decide_store reseller_logo_count reseller_me reseller_my_orders reseller_my_store reseller_payout_paid reseller_payout_reject reseller_payout_reveal reseller_quick_start reseller_request_cancel reseller_request_payout reseller_save_payout_account reseller_save_store reseller_store reseller_store_products reseller_submit_store reseller_telegram_code rifai_orders_net',
    '11و دوال authenticated');
  perform pg_temp.want(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'reseller%' and p.prosecdef and not coalesce(p.proconfig::text ~ 'search_path', false)), '11ز كل دالة definer لها search_path');

  -- ب) بيانات في كل جدول للمتجرين
  perform pg_temp.as_('authenticated', pg_temp.f('A'));
  insert into public.reseller_product_requests (store_id, name) values (pg_temp.f('A.store'), 'طلب أ'); perform public.reseller_telegram_code();
  perform pg_temp.as_('authenticated', pg_temp.f('B'));
  insert into public.reseller_product_requests (store_id, name) values (pg_temp.f('B.store'), 'طلب ب'); perform public.reseller_telegram_code(); insert into public.reseller_products (store_id, product_id) values (pg_temp.f('B.store'), pg_temp.f('P'));
  perform pg_temp.out();

  -- ج) الصفوف التي يراها كل طرف ولا تخصّه
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'reseller%' and c.relkind = 'r'
            and c.relname not in ('reseller_identities', 'reseller_logins', 'reseller_secrets') order by 1 loop   -- بلا متجر: يغطيها 14 و15
    foreach s in array array['A', 'B', 'N', 'mona', 'sup', 'admin'] loop
      execute format('select count(*) from public.%I x where %s', t.relname, case t.relname when 'reseller_stores' then format('owner_id is distinct from %L', pg_temp.f(s))
        when 'reseller_order_items' then format('not exists (select 1 from public.reseller_orders o where o.order_id = x.order_id and o.store_id = %L)', pg_temp.f(s || '.store'))
        else format('store_id is distinct from %L', pg_temp.f(s || '.store')) end) into m;
      perform pg_temp.want(m > 0, '11ح يوجد ما يُخفى: ' || t.relname || '/' || s);
      perform pg_temp.as_('authenticated', pg_temp.f(s));
      begin
        execute format('select count(*) from public.%I x where %s', t.relname, case t.relname when 'reseller_stores' then format('owner_id is distinct from %L', pg_temp.f(s))
          when 'reseller_order_items' then format('not exists (select 1 from public.reseller_orders o where o.order_id = x.order_id and o.store_id = %L)', pg_temp.f(s || '.store'))
          else format('store_id is distinct from %L', pg_temp.f(s || '.store')) end) into n;
      exception when insufficient_privilege then n := 0; end;
      perform pg_temp.out();
      if s = 'admin' and t.relname not in ('reseller_payout_accounts', 'reseller_telegram') then
        perform pg_temp.eq(n, m, '11ط المدير يرى الكل: ' || t.relname);
      elsif s = 'sup' and t.relname in ('reseller_stores', 'reseller_product_requests') then
        perform pg_temp.eq(n, m, '11ي المشرف يرى: ' || t.relname);
      else
        perform pg_temp.eq(n, 0::bigint, '11ك ' || s || ' لا يرى من غيره: ' || t.relname);
      end if;
    end loop;
    foreach s in array array['select * from public.%I', 'insert into public.%I default values', 'delete from public.%I'] loop
      perform pg_temp.as_('anon');
      perform pg_temp.fails(format(s, t.relname), 'permission denied', '11ل anon مرفوض: ' || format(s, t.relname));
      perform pg_temp.out();
    end loop;
  end loop;

  -- د) المروّج على طلبات القاعدة وجداولها
  perform pg_temp.as_('authenticated', pg_temp.f('A'));
  perform pg_temp.eq((select count(*) from public.orders) + (select count(*) from public.products) + (select count(*) from public.product_prices) + (select count(*) from public.stock_movements)
    + (select count(*) from public.app_settings) + (select count(*) from public.zad_deliveries) + (select count(*) from public.telegram_agents) + (select count(*) from public.rifai_orders_net()), 0::bigint, '11م المروّج لا يقرأ جداول الرفاعي');
  perform pg_temp.eq((public.finance_summary(current_date - 1, current_date)->>'sales_total')::bigint, 0::bigint, '11ن ولا مبيعاته');
  update public.orders set status = 'delivered'; get diagnostics n = row_count;
  perform pg_temp.eq(n, 0::bigint, '11س ولا يغيّر حالة طلبه');
  select order_id into o from public.reseller_my_orders() limit 1;
  perform pg_temp.fails(format('select public.zad_dispatch(%L)', o), 'غير مسموح', '11ع ولا يستدعي كابتناً');
  perform pg_temp.want(not exists (select 1 from public.reseller_my_orders(200) where customer_phone is not null or customer_note is not null), '11ف هاتف الزبون وملاحظته محجوبان');
  perform pg_temp.out();
  perform pg_temp.cfg('reseller_show_customer_phone', 'on');
  perform pg_temp.as_('authenticated', pg_temp.f('A'));
  perform pg_temp.want(exists (select 1 from public.reseller_my_orders(200) where customer_phone is not null), '11ص ويظهر بالإعداد');
  perform pg_temp.out();
  perform pg_temp.cfg('reseller_show_customer_phone', 'off');

  -- هـ) ب على أشياء أ بالدوال وبالكتابة المباشرة
  o := (select ro.order_id from public.reseller_orders ro join public.orders x on x.id = ro.order_id where ro.store_id = pg_temp.f('A.store') and x.status = 'new' and ro.cancel_requested_at is null limit 1); p := pg_temp.open_payout('A');
  perform pg_temp.want(p is not null, '11ق لأ طلب استلام مفتوح');
  perform pg_temp.as_('authenticated', pg_temp.f('B'));
  perform pg_temp.want(not exists (select 1 from public.reseller_my_orders(200) x where x.order_id = o), '11ر my_orders لا يعيد طلب أ');
  perform pg_temp.fails(format('select public.reseller_cancel_payout(%L)', p), 'غير موجود', '11ش ب لا يلغي استلام أ');
  perform pg_temp.fails(format('select public.reseller_request_cancel(%L, ''x'')', o), 'لا يمكن', '11ت ب لا يطلب إلغاء طلب أ');
  foreach s in array array[format('select public.reseller_payout_paid(%L, ''REF'', 901)', p), format('select public.reseller_payout_reject(%L, ''سبب'', 901)', p), format('select public.reseller_adjust(%L, 1000000, ''هدية'')', pg_temp.f('B.store'))] loop
    perform pg_temp.fails(s, 'لمدير الرفاعي', '11ث ب ليس مديراً: ' || left(s, 34));
  end loop;
  foreach s in array array[
    format('insert into public.reseller_products (store_id, product_id) values (%L, %L)', pg_temp.f('A.store'), pg_temp.f('P')),
    format('insert into public.reseller_categories (store_id, category_id) select %L, min(id) from public.categories', pg_temp.f('A.store')),
    format('insert into public.reseller_product_requests (store_id, name) values (%L, ''xx'')', pg_temp.f('A.store')),
    format('update public.reseller_products set store_id = %L where store_id = %L', pg_temp.f('A.store'), pg_temp.f('B.store'))] loop
    perform pg_temp.fails(s, 'row-level security', '11خ ب لا يكتب في متجر أ: ' || left(s, 45));
  end loop;
  update public.reseller_products set price_override = 1 where store_id = pg_temp.f('A.store'); get diagnostics n = row_count;
  delete from public.reseller_categories where store_id = pg_temp.f('A.store'); get diagnostics m = row_count;
  perform pg_temp.eq(n + m, 0::bigint, '11ذ ولا يعدّل ولا يحذف');
  foreach s in array array['update public.reseller_stores set status = ''active''', 'insert into public.reseller_ledger (store_id, kind, amount) values (null, ''adjustment'', 1)',
    'update public.reseller_payouts set status = ''paid''', 'insert into public.reseller_payout_accounts (store_id) values (null)', 'update public.reseller_orders set cycle = 0',
    'insert into public.reseller_audit (store_id, actor, action) values (null, '''', '''')', 'select * from public.reseller_telegram',
    'insert into public.reseller_product_requests (store_id, name, status) values (null, ''xx'', ''available'')'] loop
    perform pg_temp.fails(s, 'permission denied', '11ض ولا كتابة مباشرة: ' || left(s, 50));
  end loop;
  update public.reseller_product_requests set status = 'available'; get diagnostics n = row_count;
  perform pg_temp.eq(n, 0::bigint, '11ظ ولا يوافق على طلب توفيره');

  -- و) دوال داخلية لا يستدعيها أحد من المتصفح
  foreach s in array array['public.reseller_lines(null)', 'public.reseller_lock(null)', 'public.reseller_auto_payouts()', 'public.reseller_available(null)', 'public.reseller_cfg(''reseller_base'')',
    'public.reseller_notify_admins(''x'')', 'public.reseller_telegram_link(''x'', 1)', 'public.reseller_mask(''x'')'] loop
    perform pg_temp.fails('select ' || s, 'permission denied', '11غ authenticated ممنوع: ' || s);
  end loop;
  perform pg_temp.as_('anon');
  perform pg_temp.fails('select public.reseller_balance()', 'permission denied', '11غ2 anon لا رصيد');
  perform pg_temp.fails('select public.reseller_catalog()', 'permission denied', '11غ3 anon لا كتالوج');
  perform pg_temp.out();

  -- ز) متجر غير فعّال بكل حالاته
  foreach s in array array['draft', 'pending', 'suspended', 'rejected'] loop
    update public.reseller_stores set status = s where id = pg_temp.f('F.store');
    perform pg_temp.as_('anon');
    perform pg_temp.want(public.reseller_store('store-f') is null and not exists (select 1 from public.reseller_store_products('store-f')), '11أأ غير فعّال لا يظهر: ' || s);
    perform pg_temp.fails(format('select public.reseller_create_order(''store-f'', ''زبون'', ''07712345678'', jsonb_build_array(pg_temp.item(''P'', 1)), %s)', (select id from public.delivery_zones where name = 'منطقة فحص زاد')), 'المتجر غير متاح', '11أب ولا يُطلب منه: ' || s);
    perform pg_temp.out();
  end loop;
  perform pg_temp.as_('anon');
  perform pg_temp.eq((select string_agg(k, ',' order by k) from jsonb_object_keys(public.reseller_store('store-a')) k), 'about,logo_path,name,open,slug,theme_color,whatsapp,zones', '11أج الواجهة بلا مالك ولا هاتف خاص');
  perform pg_temp.want(exists (select 1 from jsonb_array_elements(public.reseller_store('store-a')->'zones') z where z->>'name' = 'منطقة فحص زاد' and (z->>'fee')::int = 2000)
    and not exists (select 1 from jsonb_array_elements(public.reseller_store('store-a')->'zones') z where z->>'name' in ('استلام فحص', 'استلام من المحل')), '11أج2 المناطق: زاد فقط بلا الاستلام من المحل');
  perform pg_temp.out();

  -- ح) الشعارات
  perform pg_temp.as_('authenticated', pg_temp.f('A'));
  insert into storage.objects (bucket_id, name) values ('reseller-logos', pg_temp.f('A') || '/logo.png');
  perform pg_temp.fails(format('insert into storage.objects (bucket_id, name) values (''reseller-logos'', %L)', pg_temp.f('B') || '/logo.png'), 'row-level security', '11أد لا رفع في مجلد غيره');
  perform pg_temp.fails('insert into storage.objects (bucket_id, name) values (''reseller-logos'', ''logo.png'')', 'row-level security', '11أهـ ولا في الجذر');
  perform pg_temp.fails(format('insert into storage.objects (bucket_id, name) values (''product-images'', %L)', pg_temp.f('A') || '/x.png'), 'row-level security', '11أو ولا في صور الرفاعي');
  perform pg_temp.as_('anon');
  perform pg_temp.fails('insert into storage.objects (bucket_id, name) values (''reseller-logos'', ''x/logo.png'')', 'row-level security', '11أز anon لا يرفع');
  perform pg_temp.out();
  -- سقف الشعارات: 5 لكل مستخدم، والحذف ثم الرفع يعمل، ومستخدم آخر لا يتأثر
  perform pg_temp.as_('authenticated', pg_temp.f('A'));
  for i in 2..5 loop insert into storage.objects (bucket_id, name) values ('reseller-logos', pg_temp.f('A') || '/l' || i || '.png'); end loop;
  perform pg_temp.fails(format('insert into storage.objects (bucket_id, name) values (''reseller-logos'', %L)', pg_temp.f('A') || '/l6.png'), 'row-level security', '11ب1 السادس ممنوع');
  delete from storage.objects where bucket_id = 'reseller-logos' and name = pg_temp.f('A') || '/l2.png';
  perform pg_temp.runs(format('insert into storage.objects (bucket_id, name) values (''reseller-logos'', %L)', pg_temp.f('A') || '/l6.png'), '11ب2 الحذف ثم الرفع يعمل');
  perform pg_temp.as_('authenticated', pg_temp.f('B'));
  perform pg_temp.runs(format('insert into storage.objects (bucket_id, name) values (''reseller-logos'', %L)', pg_temp.f('B') || '/logo.png'), '11ب3 سقف مستخدم لا يمسّ غيره');
  perform pg_temp.out();
  perform pg_temp.eq((select file_size_limit || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'reseller-logos'), '1048576image/png,image/jpeg,image/webp', '11أح حدود الحاوية');

  -- ط) ربط تيليغرام
  s := (select code from public.reseller_telegram where store_id = pg_temp.f('A.store'));
  perform pg_temp.as_('service_role');
  perform pg_temp.want(public.reseller_telegram_link('rs_bad', 55) is null, '11أط رمز خاطئ');
  perform pg_temp.eq(public.reseller_telegram_link(s, 55), 'متجر store-a', '11أي الرمز يربط');
  perform pg_temp.want(public.reseller_telegram_link(s, 56) is null, '11أك ويُستهلك مرة');
  perform pg_temp.out();
  perform pg_temp.want(not exists (select 1 from public.telegram_agents where telegram_id = 55), '11أل ولا يصير عضواً في بوت الرفاعي');

  -- ي) حد طلبات التوفير
  perform pg_temp.as_('authenticated', pg_temp.f('A'));
  insert into public.reseller_product_requests (store_id, name) select pg_temp.f('A.store'), 'طلب ' || i from generate_series(1, 19) i;
  perform pg_temp.fails(format('insert into public.reseller_product_requests (store_id, name) values (%L, ''زائد'')', pg_temp.f('A.store')), '20 طلب', '11أم الحادي والعشرون');
  perform public.reseller_request_cancel((select x.order_id from public.reseller_my_orders(200) x where x.status = 'new' limit 1), 'سبب');
  perform pg_temp.out();
  perform pg_temp.want(exists (select 1 from public.reseller_orders ro join public.orders o2 on o2.id = ro.order_id where ro.cancel_requested_at is not null and o2.status = 'new'), '11أن طلب الإلغاء لا يلغي');
end $$;

-- ---------- 12) الميزان: كل دينار في القيود مفسَّر ----------
do $$
begin
  perform pg_temp.want(not exists (
    select 1 from public.reseller_orders ro join public.orders o on o.id = ro.order_id
     where (select coalesce(sum(amount), 0) from public.reseller_ledger l where l.order_id = ro.order_id) <> case when o.status = 'delivered' then ro.profit else 0 end), '12أ قيود كل طلب = ربحه إن كان مُسلَّماً وإلا صفر');
  perform pg_temp.want(not exists (
    select 1 from public.reseller_payouts p where (select coalesce(-sum(amount), 0) from public.reseller_ledger l where l.payout_id = p.id) <> case when status = 'paid' then p.amount else 0 end), '12ب قيد الدفع = مبلغ الطلب المدفوع');
  perform pg_temp.want(not exists (select 1 from public.reseller_orders ro join public.orders o on o.id = ro.order_id
     where o.subtotal <> ro.reseller_subtotal or ro.base_subtotal <> (select sum(base_total) from public.reseller_order_items i where i.order_id = o.id)
        or ro.reseller_subtotal <> (select sum(sell_total) from public.reseller_order_items i where i.order_id = o.id)), '12ج مجاميع الطلب = بنوده');
end $$;

-- ---------- 13) التقرير اليومي بوجود طلب مروّج ----------
create function pg_temp.daily() returns text language plpgsql as $$
begin
  delete from net.http_request_queue;
  perform public.send_daily_sales_report();
  return (select convert_from(body, 'UTF8')::jsonb->>'text' from net.http_request_queue limit 1);
end $$;
do $$
declare a text; b text; g text := '%s: (?:<b>)?([0-9,]+)'; n int; w text;
begin
  insert into public.app_settings (key, value) values ('telegram_chat_id', '1') on conflict (key) do update set value = '1';
  update public.orders set created_at = created_at - interval '3 days' where source = 'reseller';
  a := pg_temp.daily();
  perform pg_temp.buy('store-b', pg_temp.item('P', 2));
  b := pg_temp.daily();
  foreach w in array array['بضاعة|14000', 'إجمالي المبيعات|16000', 'نقد|16000', 'توصيل|2000'] loop
    perform pg_temp.eq(replace(substring(b from format(g, split_part(w, '|', 1))), ',', '')::int - replace(substring(a from format(g, split_part(w, '|', 1))), ',', '')::int,
      split_part(w, '|', 2)::int, '13أ التقرير اليومي صافٍ: ' || split_part(w, '|', 1));
  end loop;
  perform pg_temp.want(b ~ 'منتج P — 2 قطعة \(14,000 د.ع\)', '13ب والأكثر مبيعاً بالأساس');
end $$;

-- ---------- 14) الدخول عبر تيليغرام والبدء السريع ----------
do $$
declare r jsonb; n text; h text := repeat('a', 64); h2 text := repeat('b', 64); opts int[]; num int; u uuid; u2 uuid; u3 uuid;
        t bigint := 5550001; sid uuid; s1 text; s2 text; ok boolean := false; i int;
begin
  perform pg_temp.out();
  u := pg_temp.mk_user('T1'); u2 := pg_temp.mk_user('T2'); u3 := pg_temp.mk_user('T3');
  perform pg_temp.as_('service_role');

  -- أول دخول: يمرّ بالرقم ثم بجهة الاتصال
  r := public.reseller_login_new(h); n := r->>'nonce'; num := (r->>'number')::int;
  perform pg_temp.want(num between 10 and 99 and length(n) = 16, '14أ رمز ورقم');
  perform pg_temp.eq(public.reseller_login_poll(n, h)->>'status', 'waiting', '14ب الانتظار');
  perform pg_temp.eq(public.reseller_login_poll(n, h2)->>'status', 'expired', '14ج سرّ خاطئ = منتهية');
  opts := public.reseller_login_claim(n, t, 'علي');
  perform pg_temp.want(array_length(opts, 1) = 3 and num = any(opts) and (select count(distinct x) from unnest(opts) x) = 3, '14د ثلاثة أرقام مختلفة فيها الصحيح');
  perform pg_temp.want(public.reseller_login_claim(n, t + 1, 'غريب') is null, '14هـ الثاني لا يحجز المحاولة');
  perform pg_temp.eq(public.reseller_login_pick(n, t + 1, num), 'expired', '14و غير الحاجز لا يؤكد');
  perform pg_temp.eq(public.reseller_login_pick(n, t, num), 'need_phone', '14ز الصحيح يطلب جهة الاتصال أول مرة');
  perform pg_temp.eq(public.reseller_login_phone(t, t + 9, '07701234567'), 'not_yours', '14ح جهة اتصال غيرك مرفوضة');
  perform pg_temp.eq(public.reseller_login_phone(t, t, '+442071234567'), 'bad_phone', '14ط رقم غير عراقي');
  perform pg_temp.eq(public.reseller_login_phone(t, t, '+9647701234567'), 'ok', '14ي جهة الاتصال تُقبل');
  r := public.reseller_login_poll(n, h);
  perform pg_temp.want(r->>'status' = 'ok' and r->>'phone' = '9647701234567' and (r->>'user_id') is null and (r->>'telegram_id')::bigint = t, '14ك الصفحة تستلم الهوية');
  perform pg_temp.eq(public.reseller_login_poll(n, h)->>'status', 'expired', '14ل مرة واحدة فقط');
  perform pg_temp.eq(public.reseller_identity_save(t, u, 'علي', '9647701234567'), u, '14م تثبيت الهوية');

  -- دخول ثانٍ: بلا جهة اتصال، ويعيد المستخدم نفسه
  r := public.reseller_login_new(h); n := r->>'nonce'; num := (r->>'number')::int;
  perform public.reseller_login_claim(n, t, 'علي');
  perform pg_temp.eq(public.reseller_login_pick(n, t, num), 'confirmed', '14ن العائد لا يُسأل عن هاتفه');
  perform pg_temp.eq((public.reseller_login_poll(n, h)->>'user_id')::uuid, u, '14س وتعود الجلسة لنفس المستخدم');

  -- رقم خاطئ يُلغي المحاولة ولو أعاد الصحيح
  r := public.reseller_login_new(h); n := r->>'nonce'; num := (r->>'number')::int;
  perform public.reseller_login_claim(n, t, 'علي');
  perform pg_temp.eq(public.reseller_login_pick(n, t, case when num = 10 then 11 else 10 end), 'wrong', '14ع رقم خاطئ');
  perform pg_temp.eq(public.reseller_login_pick(n, t, num), 'expired', '14ف ولا رجعة بعده');
  perform pg_temp.eq(public.reseller_login_poll(n, h)->>'status', 'failed', '14ص والصفحة تعلم');

  -- انتهاء الصلاحية
  r := public.reseller_login_new(h); n := r->>'nonce';
  perform pg_temp.out();
  update public.reseller_logins set expires_at = now() - interval '1 second' where nonce = n;
  perform pg_temp.as_('service_role');
  perform pg_temp.want(public.reseller_login_claim(n, t, 'علي') is null, '14ق رمز منتهٍ لا يُحجز');

  -- حدّ المحاولات
  begin
    for i in 1..120 loop perform public.reseller_login_new(h); end loop;
  exception when others then ok := sqlerrm like '%محاولات كثيرة%';
  end;
  perform pg_temp.want(ok, '14ر حدّ المحاولات في الدقيقة');
  perform pg_temp.fails('select public.reseller_login_new(''xyz'')', 'طلب غير صالح', '14ش سرّ غير مجزَّأ');
  perform pg_temp.out();

  -- البدء السريع
  perform pg_temp.as_('authenticated', pg_temp.f('A'));
  perform pg_temp.want(public.reseller_me() is null, '14ت من بلا هوية تيليغرام لا ملف له');
  perform pg_temp.fails('select public.reseller_quick_start(''متجر'')', 'سجّل الدخول عبر تيليغرام', '14ث بلا هوية لا بدء');
  perform pg_temp.out();
  perform pg_temp.as_('service_role');
  perform public.reseller_identity_save(t + 7, u2, 'بلا هاتف', null);
  perform public.reseller_identity_save(t + 8, u3, 'سارة', '9647711111111');
  perform pg_temp.out();
  perform pg_temp.as_('authenticated', u2);
  perform pg_temp.fails('select public.reseller_quick_start(''متجر بلا هاتف'')', 'شارك رقمك', '14خ بلا هاتف موثَّق لا بدء');
  perform pg_temp.as_('authenticated', u);
  perform pg_temp.fails('select public.reseller_quick_start(''م'')', 'اسم المتجر', '14ذ الاسم قصير');
  perform pg_temp.runs('select public.reseller_quick_start(''متجر النور الجديد'')', '14ض البدء بالاسم وحده');
  perform pg_temp.out();
  select id, slug into sid, s1 from public.reseller_stores where owner_id = u;
  perform pg_temp.want(s1 ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and public.reseller_slug_ok(s1), '14غ رابط لاتيني صالح: ' || s1);
  perform pg_temp.want((select status = 'draft' and phone = '9647701234567' and markup_type = 'percent' and markup_value = 20 and round_to = 250 and theme_color ~ '^#[0-9a-f]{6}$'
                          from public.reseller_stores where id = sid), '14ظ الافتراضات: مسودة، هاتف موثَّق، زيادة، لون');
  perform pg_temp.want((select count(*) from public.reseller_categories where store_id = sid) = (select count(*) from public.categories c where c.store = 'rifai'
                          and exists (select 1 from public.products p where p.category_id = c.id and p.is_active and p.store = 'rifai'))
                        and exists (select 1 from public.reseller_categories where store_id = sid), '14أأ كل الأصناف مختارة');
  perform pg_temp.eq((select chat_id from public.reseller_telegram where store_id = sid), t, '14أب الدخول يربط إشعارات تيليغرام');
  perform pg_temp.as_('authenticated', u);
  perform pg_temp.eq((select public.reseller_quick_start('اسم آخر')), sid, '14أج مرة ثانية: المتجر نفسه (لا نسخة)');
  perform pg_temp.eq(public.reseller_me()->'store'->>'status', 'draft', '14أد من أنا: حالة المتجر');
  perform pg_temp.eq(public.reseller_me()->>'phone', '07701234567', '14أهـ الهاتف يُعرض محلياً بلا 964');
  perform pg_temp.out();
  perform pg_temp.as_('authenticated', u3);
  perform pg_temp.runs('select public.reseller_quick_start(''متجر النور الجديد'')', '14أو نفس الاسم من آخر');
  perform pg_temp.out();
  select slug into s2 from public.reseller_stores where owner_id = u3;
  perform pg_temp.want(s2 <> s1 and public.reseller_slug_ok(s2), '14أز تكرار الاسم يُحلّ برابط مختلف: ' || s2);
  perform pg_temp.eq(public.reseller_slugify('متجر النور'), 'mtjr-alnwr', '14أح تحويل الاسم العربي');
  perform pg_temp.want(public.reseller_slug_ok(public.reseller_free_slug('Rifai Shop')) and public.reseller_free_slug('Rifai Shop') !~ 'rifa', '14أط اسم ينتحل الرفاعي لا يصير رابطاً');

  -- الإرسال بعد البدء السريع، والتسرّب
  perform pg_temp.as_('authenticated', u);
  perform pg_temp.runs('select public.reseller_submit_store()', '14أي الإرسال للموافقة بعد البدء');
  perform pg_temp.want(not public.is_staff() and not public.is_supervisor() and not public.is_admin(), '14أص مستخدم تيليغرام الجديد ليس موظفاً ولا مشرفاً ولا مديراً');
  perform pg_temp.eq((select count(*) from public.reseller_category_list() where selected), (select count(*) from public.reseller_categories where store_id = sid), '14أف قائمة الأصناف المختارة');
  perform pg_temp.want((select count(*) from public.reseller_category_list()) >= (select count(*) from public.reseller_category_list() where selected) and not exists (select 1 from public.reseller_category_list() l join public.categories c on c.id = l.id where c.store <> 'rifai'), '14أق وقائمة الأصناف بلا أصناف غيره');
  perform pg_temp.fails('select * from public.reseller_identities', 'permission denied', '14أك الهويات محجوبة عن المتصفح');
  perform pg_temp.fails('select * from public.reseller_logins', 'permission denied', '14أل ومحاولات الدخول');
  perform pg_temp.fails('select public.reseller_login_new(repeat(''a'', 64))', 'permission denied', '14أم دوال الدخول ليست للمتصفح');
  perform pg_temp.as_('anon');
  perform pg_temp.fails('select public.reseller_quick_start(''متجر'')', 'permission denied', '14أن ولا بدء لزائر');
  perform pg_temp.fails('select * from public.reseller_category_list()', 'permission denied', '14أه ولا قائمة أصناف لزائر');
  perform pg_temp.fails('select public.reseller_login_poll(''x'', repeat(''a'', 64))', 'permission denied', '14أس ولا استعلام دخول');
  foreach n in array array['select * from public.reseller_identities', 'insert into public.reseller_identities default values', 'delete from public.reseller_logins', 'select * from public.reseller_logins'] loop
    perform pg_temp.fails(n, 'permission denied', '14أع anon مرفوض: ' || n);
  end loop;
  perform pg_temp.out();
end $$;

-- ---------- 15) أسرار البوت ----------
do $$
declare u uuid := pg_temp.mk_user('T9');
begin
  perform pg_temp.out();
  insert into public.reseller_secrets (key, value) values ('bot_token', 'x:y');
  perform pg_temp.as_('service_role');
  perform pg_temp.eq(public.reseller_secret('bot_token'), 'x:y', '15أ1 الدالة تقرأ السرّ لمفتاح الخدمة');
  perform pg_temp.fails('select * from public.reseller_secrets', 'permission denied', '15أ2 ولا قراءة مباشرة حتى لمفتاح الخدمة');
  perform pg_temp.as_('authenticated', u);
  perform pg_temp.fails('select public.reseller_secret(''bot_token'')', 'permission denied', '15أ3 ولا للمتصفح المسجَّل');
  perform pg_temp.fails('select * from public.reseller_secrets', 'permission denied', '15أ4 ولا الجدول');
  perform pg_temp.as_('anon');
  perform pg_temp.fails('select public.reseller_secret(''bot_token'')', 'permission denied', '15أ5 ولا للزائر');
  perform pg_temp.out();
  perform pg_temp.fails('insert into public.reseller_secrets (key, value) values (''other'', ''v'')', 'check', '15أ6 مفاتيح محددة فقط');
end $$;
