-- =====================================================================
-- المنى — فحص سريع بعد الترحيل
-- =====================================================================
--   PGPASS='...' node supabase/run-sql.mjs supabase/mona-smoke-test.sql \
--     aws-0-eu-central-1.pooler.supabase.com 5432 postgres.slrhxeozdadonarkclba
--
-- كل فحص يرفع استثناءً إن فشل. «OK» في آخر السطر يعني نجاح الجميع.
-- لا يكتب شيئاً دائماً: كل ما يُنشئه يُحذف في النهاية.
-- =====================================================================

do $$
declare
  v_cat   int;
  v_prod  uuid;
  v_n     int;
  v_price bigint;
begin
  -- ===================================================================
  -- 1) معادلة السعر — بلا لمس أي بيانات
  -- ===================================================================
  -- جملة 1000 + 25% = 1250، وهو مضاعف لـ 250 فيبقى كما هو
  if public.mona_price(1000, 0, null, 'rifai', 25, 250) <> 1250 then
    raise exception 'فشل 1أ: الجملة + النسبة';
  end if;

  -- جملة 1100 + 25% = 1375 → يُقرّب لأعلى إلى 1500
  if public.mona_price(1100, 0, null, 'rifai', 25, 250) <> 1500 then
    raise exception 'فشل 1ب: التقريب لأعلى';
  end if;

  -- السعر المثبّت يتجاوز النسبة والتقريب معاً
  if public.mona_price(1000, 0, 999, 'rifai', 25, 250) <> 999 then
    raise exception 'فشل 1ج: السعر المثبّت';
  end if;

  -- جملة 0 → نرجع لسعر المفرد (2000 + 25% = 2500)
  if public.mona_price(0, 2000, null, 'rifai', 25, 250) <> 2500 then
    raise exception 'فشل 1د: الرجوع لسعر المفرد';
  end if;

  -- السعران 0 → «السعر عند الطلب» يبقى 0 ولا يتحوّل إلى رقم
  if public.mona_price(0, 0, null, 'rifai', 25, 250) <> 0 then
    raise exception 'فشل 1هـ: السعر عند الطلب';
  end if;

  -- منتج المنى: السعر كما أُدخل، بلا نسبة
  if public.mona_price(3000, 5000, null, 'mona', 25, 250) <> 5000 then
    raise exception 'فشل 1و: منتج المنى بلا نسبة';
  end if;

  -- تقريب 0 لا يقسم على صفر
  if public.mona_price(1000, 0, null, 'rifai', 25, 0) <> 1250 then
    raise exception 'فشل 1ز: حماية القسمة على صفر';
  end if;

  raise notice '1) معادلة السعر: نجح';

  -- ===================================================================
  -- 2) السياج — بمنتج منى حقيقي مؤقت
  -- ===================================================================
  insert into public.categories (name, sort_order, store)
  values ('__فحص_صنف_منى__', 999, 'mona') returning id into v_cat;

  insert into public.products (name, category_id, quantity_single, store)
  values ('__فحص_منتج_منى__', v_cat, 10, 'mona') returning id into v_prod;

  -- trg_ensure_price_row أنشأ صف الأسعار تلقائياً؛ نضع سعر المنى
  update public.product_prices
     set price_retail = 7000, price_wholesale = 5000
   where product_id = v_prod;

  -- 2أ) لا يظهر عند الرفاعي إطلاقاً
  select count(*) into v_n from public.storefront_products where id = v_prod;
  if v_n <> 0 then
    raise exception 'فشل 2أ: منتج المنى ظاهر في متجر الرفاعي';
  end if;

  -- 2ب) يظهر في المنى بسعره المُدخل بلا نسبة
  select price_retail into v_price from public.mona_storefront_products where id = v_prod;
  if v_price is distinct from 7000 then
    raise exception 'فشل 2ب: سعر منتج المنى % بدل 7000', v_price;
  end if;

  -- 2ج) الإخفاء يعمل، ولا يمسّ الرفاعي
  insert into public.mona_product_overrides (product_id, is_visible)
  values (v_prod, false);
  select count(*) into v_n from public.mona_storefront_products where id = v_prod;
  if v_n <> 0 then
    raise exception 'فشل 2ج: المنتج المخفيّ ما زال ظاهراً';
  end if;

  -- 2د) السعر المثبّت من جدول التجاوزات
  update public.mona_product_overrides
     set is_visible = true, price_override = 6000 where product_id = v_prod;
  select price_retail into v_price from public.mona_storefront_products where id = v_prod;
  if v_price is distinct from 6000 then
    raise exception 'فشل 2د: السعر المثبّت لم يُطبّق (%)', v_price;
  end if;

  -- 2هـ) صنف المنى لا يظهر في أصناف الرفاعي
  select count(*) into v_n from public.categories
   where id = v_cat and store = 'rifai';
  if v_n <> 0 then
    raise exception 'فشل 2هـ: صنف المنى موسوم rifai';
  end if;

  raise notice '2) السياج: نجح';

  -- ===================================================================
  -- 3) الطلب: create_order الرفاعي يرفض منتج منى حتى لو عُرف معرّفه
  -- ===================================================================
  begin
    perform public.create_order('فحص', '07700000000',
      jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 1)),
      'retail', (select id from public.delivery_zones where is_active order by id limit 1), null);
    raise exception 'فشل 3: متجر الرفاعي قبل طلب منتج منى';
  exception
    when sqlstate 'P0001' then
      if sqlerrm = 'فشل 3: متجر الرفاعي قبل طلب منتج منى' then raise; end if;
      raise notice '3) رفض الطلب المختلط: نجح (%)', sqlerrm;
  end;

  -- ===================================================================
  -- تنظيف
  -- ===================================================================
  delete from public.mona_product_overrides where product_id = v_prod;
  delete from public.stock_movements        where product_id = v_prod;
  delete from public.product_prices         where product_id = v_prod;
  delete from public.products                where id = v_prod;
  delete from public.categories              where id = v_cat;

  raise notice 'OK — كل الفحوص نجحت والبيانات المؤقتة حُذفت';
end $$;


-- ---------------------------------------------------------------------
-- 4) الأعمدة المكشوفة لـ anon: يجب ألا تحوي price_wholesale ولا store
-- ---------------------------------------------------------------------
select string_agg(column_name, ', ' order by ordinal_position) as "أعمدة عرض المنى العام"
  from information_schema.columns
 where table_schema = 'public' and table_name = 'mona_storefront_products';

-- ---------------------------------------------------------------------
-- 5) لقطة عامة
-- ---------------------------------------------------------------------
select
  (select count(*) from public.storefront_products)      as "منتجات الرفاعي",
  (select count(*) from public.mona_storefront_products) as "منتجات المنى",
  (select count(*) from public.mona_categories)          as "أصناف المنى",
  (select value from public.app_settings where key = 'mona_markup_percent') as "نسبة الربح",
  (select value from public.app_settings where key = 'mona_round_to')       as "التقريب";
