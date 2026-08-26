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
  v_prod  uuid;   -- منتج مسعّر
  v_ask   uuid;   -- منتج «السعر عند الطلب»
  v_res   jsonb;
  v_ord   uuid;
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

  -- 2) منتج غير مسعّر يظهر في المتجر بسعر 0 = «السعر عند الطلب» (قرار المالك)
  assert (select price_retail from public.storefront_products where id = v_prod) = 0,
    'فشل: المنتج غير المسعّر لا يظهر في المتجر بسعر 0';

  update public.product_prices
     set price_wholesale = 6000, price_retail = 10000 where product_id = v_prod;

  -- 3) العرض يقدّم السعرين (وضعا الجملة والمفرد)
  assert (select price_retail    from public.storefront_products where id = v_prod) = 10000
     and (select price_wholesale from public.storefront_products where id = v_prod) =  6000,
    'فشل: العرض لا يقدّم سعرَي المفرد والجملة';

  -- 4) منطق الدرزن: 2 درزن + 3 مفرد = 27 قطعة
  insert into public.stock_movements (product_id, type, dozen_qty, singles_qty, created_by)
  values (v_prod, 'stock_in', 2, 3, v_entry);

  select quantity_single into v_qty from public.products where id = v_prod;
  assert v_qty = 27, format('فشل: حساب الدرزن أعطى %s بدل 27', v_qty);

  -- 5) منع الرصيد السالب برسالة عربية
  begin
    insert into public.stock_movements (product_id, type, dozen_qty, singles_qty)
    values (v_prod, 'sale', 0, -100);
    raise exception 'فشل: سُمح برصيد سالب';
  exception when others then
    if position('الرصيد المتوفر' in sqlerrm) = 0 then raise; end if;
  end;

  -- 6) طلب مفرد: المجموع يُحسب من القاعدة (3 × 10٬000 = 30٬000)
  v_res := public.create_order('زبون تجريبي', '07701234567',
             jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 3)), 'retail', 1);
  v_ord := (v_res->>'order_id')::uuid;

  assert (v_res->>'subtotal')::bigint = 30000,
    format('فشل: مجموع البضاعة %s بدل 30000', v_res->>'subtotal');
  -- أجرة التوصيل تُقرأ من الخادم وتُضاف: 30٬000 + 3٬000 = 33٬000
  assert (v_res->>'delivery_fee')::bigint = 3000, 'فشل: أجرة التوصيل لم تُقرأ من المنطقة';
  assert (v_res->>'total_amount')::bigint = 33000,
    format('فشل: المجموع الكلي %s بدل 33000', v_res->>'total_amount');
  assert (v_res->'items'->0->>'unit_price')::bigint = 10000,
    'فشل: السعر المحفوظ لا يطابق سعر القاعدة';

  -- 7) الخصم فور الطلب (قرار المالك): 27 − 3 = 24
  select quantity_single into v_qty from public.products where id = v_prod;
  assert v_qty = 24, format('فشل: المخزون بعد الطلب %s بدل 24', v_qty);

  -- 8) طلب جملة يقرأ سعر الجملة (2 × 6٬000 = 12٬000) والمخزون 24 − 2 = 22
  v_res := public.create_order('زبون جملة', '07701234567',
             jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 2)), 'wholesale', 14);
  assert (v_res->>'subtotal')::bigint = 12000,
    format('فشل: مجموع الجملة %s بدل 12000', v_res->>'subtotal');
  assert (v_res->>'delivery_fee')::bigint = 0, 'فشل: «استلام من المحل» يجب أن تكون بلا أجرة';
  assert (v_res->>'mode') = 'wholesale', 'فشل: وضع البيع لم يُحفظ';

  select quantity_single into v_qty from public.products where id = v_prod;
  assert v_qty = 22, format('فشل: المخزون بعد طلب الجملة %s بدل 22', v_qty);

  -- 9) إلغاء الطلب يعيد الكمية: 22 + 3 = 25
  update public.orders set status = 'cancelled' where id = v_ord;
  select quantity_single into v_qty from public.products where id = v_prod;
  assert v_qty = 25, format('فشل: الإلغاء لم يُعِد الكمية (%s بدل 25)', v_qty);

  -- 10) إعادة تفعيل الطلب الملغى تخصم الكمية من جديد: 25 − 3 = 22
  update public.orders set status = 'confirmed' where id = v_ord;
  select quantity_single into v_qty from public.products where id = v_prod;
  assert v_qty = 22, format('فشل: إعادة التفعيل لم تخصم الكمية (%s بدل 22)', v_qty);

  -- 11) «السعر عند الطلب»: منتج بسعر 0 يُطلب بمجموع 0 مع علامة تنبّه المدير
  insert into public.products (barcode, name, category_id)
  values ('TEST-0002', 'شامبو بلا سعر', 7) returning id into v_ask;
  insert into public.stock_movements (product_id, type, singles_qty) values (v_ask, 'stock_in', 5);

  v_res := public.create_order('زبون', '07701234567',
             jsonb_build_array(jsonb_build_object('product_id', v_ask, 'qty', 2)), 'retail', 14);
  assert (v_res->>'subtotal')::bigint = 0, 'فشل: مجموع بند بلا سعر ليس 0';
  assert (v_res->>'has_price_request')::boolean, 'فشل: لم تُرفع علامة «السعر عند الطلب»';
  assert (v_res->'items'->0->>'price_on_request')::boolean, 'فشل: البند غير معلّم';

  -- 12) رفض كمية أكبر من المخزون
  begin
    perform public.create_order('زبون', '07701234567',
              jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 999)), 'retail', 1);
    raise exception 'فشل: قُبل طلب يتجاوز المخزون';
  exception when others then
    if position('غير متوفرة' in sqlerrm) = 0 then raise; end if;
  end;

  -- 13) رفض هاتف غير صالح ووضع بيع غير معروف
  begin
    perform public.create_order('زبون', '123',
              jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 1)), 'retail', 1);
    raise exception 'فشل: قُبل رقم هاتف غير صالح';
  exception when others then
    if position('هاتف صحيح' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.create_order('زبون', '07701234567',
              jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 1)), 'hack', 1);
    raise exception 'فشل: قُبل وضع بيع غير معروف';
  exception when others then
    if position('نوع البيع' in sqlerrm) = 0 then raise; end if;
  end;

  -- منطقة توصيل غير موجودة تُرفض (لا يستطيع المتصفح فرض أجرة من عنده)
  begin
    perform public.create_order('زبون', '07701234567',
              jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 1)), 'retail', 9999);
    raise exception 'فشل: قُبلت منطقة توصيل غير موجودة';
  exception when others then
    if position('منطقة التوصيل' in sqlerrm) = 0 then raise; end if;
  end;

  -- 14) RLS: موظف الإدخال لا يرى أي سعر ولا أي طلب
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

  -- 15) RLS: المدير يرى الأسعار والطلبات
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  assert public.is_admin(), 'فشل: المدير لا يُعتبر مديراً';
  select count(*) into v_cnt from public.product_prices;
  assert v_cnt >= 1, 'فشل: المدير لا يرى الأسعار';
  select count(*) into v_cnt from public.orders;
  assert v_cnt >= 1, 'فشل: المدير لا يرى الطلبات';

  reset role;
  raise notice '✅ كل الفحوصات نجحت (17 فحصاً) — المخطط سليم.';
end $$;

rollback;
