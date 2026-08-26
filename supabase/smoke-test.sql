-- =====================================================================
-- فحص سريع للمخطط — نفّذه في SQL Editor بعد schema.sql مباشرة.
-- يعمل داخل معاملة تُلغى في النهاية، فلا يترك أي بيانات وراءه.
-- إن ظهرت رسالة «✅ كل الفحوصات نجحت» فالمخطط سليم.
-- =====================================================================
begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_entry uuid := gen_random_uuid();
  v_prod  uuid;
  v_res   jsonb;
  v_qty   int;
  v_cnt   int;
begin
  -- مستخدمان وهميان: مدير وموظف إدخال
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'admin@test.local', '', now(), now(), now()),
         (v_entry, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'entry@test.local', '', now(), now(), now());

  update public.profiles set role = 'admin'      where id = v_admin;
  update public.profiles set role = 'data_entry' where id = v_entry;

  -- 1) إضافة منتج تُنشئ صف أسعار تلقائياً
  insert into public.products (barcode, name, category_id)
  values ('TEST-0001', 'عطر تجريبي', 1) returning id into v_prod;

  assert (select count(*) from public.product_prices where product_id = v_prod) = 1,
    'فشل: لم يُنشأ صف الأسعار تلقائياً';

  -- 2) منتج بلا سعر (0) يجب ألّا يظهر في المتجر
  assert (select count(*) from public.storefront_products where id = v_prod) = 0,
    'فشل: منتج غير مسعّر ظاهر في المتجر';

  update public.product_prices
     set price_wholesale = 6000, price_retail = 10000 where product_id = v_prod;

  assert (select count(*) from public.storefront_products where id = v_prod) = 1,
    'فشل: منتج مسعّر لا يظهر في المتجر';

  -- 3) عرض المتجر لا يكشف سعر الجملة إطلاقاً
  assert not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'storefront_products'
       and column_name = 'price_wholesale'),
    'فشل خطير: سعر الجملة مكشوف في عرض المتجر';

  -- 4) منطق الدزينة: 2 دزينة + 3 مفرد = 27 قطعة
  insert into public.stock_movements (product_id, type, dozen_qty, singles_qty, created_by)
  values (v_prod, 'stock_in', 2, 3, v_entry);

  select quantity_single into v_qty from public.products where id = v_prod;
  assert v_qty = 27, format('فشل: حساب الدزينة أعطى %s بدل 27', v_qty);

  -- 5) منع الرصيد السالب
  begin
    insert into public.stock_movements (product_id, type, dozen_qty, singles_qty)
    values (v_prod, 'sale', 0, -100);
    raise exception 'فشل: سُمح برصيد سالب';
  exception when others then
    if position('الرصيد المتوفر' in sqlerrm) = 0 then raise; end if;
  end;

  -- 6) create_order يحسب المجموع من قاعدة البيانات لا من الواجهة
  v_res := public.create_order('زبون تجريبي', '07701234567',
             jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 3)));

  assert (v_res->>'total_amount')::bigint = 30000,
    format('فشل: المجموع %s بدل 30000', v_res->>'total_amount');
  assert (v_res->>'order_number') is not null, 'فشل: لا يوجد رقم طلب';
  assert (v_res->'items'->0->>'unit_price')::bigint = 10000,
    'فشل: السعر المحفوظ لا يطابق سعر قاعدة البيانات';

  -- 7) رفض كمية أكبر من المخزون
  begin
    perform public.create_order('زبون', '07701234567',
              jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 999)));
    raise exception 'فشل: قُبل طلب يتجاوز المخزون';
  exception when others then
    if position('غير متوفرة' in sqlerrm) = 0 then raise; end if;
  end;

  -- 8) رفض هاتف غير صالح
  begin
    perform public.create_order('زبون', '123',
              jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 1)));
    raise exception 'فشل: قُبل رقم هاتف غير صالح';
  exception when others then
    if position('هاتف صحيح' in sqlerrm) = 0 then raise; end if;
  end;

  -- 9) RLS: موظف الإدخال لا يرى أي صف أسعار
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_entry, 'role', 'authenticated')::text, true);

  assert not public.is_admin(), 'فشل: موظف الإدخال يُعتبر مديراً';
  select count(*) into v_cnt from public.product_prices;
  assert v_cnt = 0, format('فشل خطير: موظف الإدخال يرى %s صف أسعار', v_cnt);

  select count(*) into v_cnt from public.orders;
  assert v_cnt = 0, 'فشل: موظف الإدخال يرى الطلبات';

  select count(*) into v_cnt from public.products;
  assert v_cnt >= 1, 'فشل: موظف الإدخال لا يرى المنتجات';

  -- 10) RLS: المدير يرى الأسعار والطلبات
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  assert public.is_admin(), 'فشل: المدير لا يُعتبر مديراً';
  select count(*) into v_cnt from public.product_prices;
  assert v_cnt >= 1, 'فشل: المدير لا يرى الأسعار';
  select count(*) into v_cnt from public.orders;
  assert v_cnt >= 1, 'فشل: المدير لا يرى الطلبات';

  reset role;
  raise notice '✅ كل الفحوصات نجحت — المخطط سليم.';
end $$;

rollback;
