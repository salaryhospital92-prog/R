-- =====================================================================
-- 010 — متجر «المنى» داخل قاعدة الرفاعي
-- =====================================================================
-- متجر نسائي ثانٍ يعيش على نفس البيانات ولا يختلط بها. الفكرة كلها عمود
-- واحد: products.store و categories.store.
--   store = 'rifai' → صفوف الرفاعي. تظهر في المنى، ولا تُكتب منها.
--   store = 'mona'  → صفوف المنى وحدها. لا تظهر عند الرفاعي إطلاقاً.
-- المخزون والصور وتوليد الرمز وحركات البيع مشتركة كما هي.
--
-- هذا الملف يضيف ما تملكه المنى وحدها. أما سياج دوال الرفاعي القائمة
-- (storefront_products و create_order و التقارير والإشعار) ففي 011،
-- لأنها دوال يملكها operations.sql وتُعاد كتابتها كلما أُعيد تشغيله.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) عمود المالك
--    الـ default يجعل كل صف قائم 'rifai' بلا أي تحديث يدوي.
-- ---------------------------------------------------------------------
alter table public.products   add column if not exists store text not null default 'rifai';
alter table public.categories add column if not exists store text not null default 'rifai';

do $$ begin
  alter table public.products add constraint products_store_check
    check (store in ('rifai', 'mona'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.categories add constraint categories_store_check
    check (store in ('rifai', 'mona'));
exception when duplicate_object then null; end $$;

create index if not exists idx_products_store   on public.products (store);
create index if not exists idx_categories_store on public.categories (store);


-- ---------------------------------------------------------------------
-- 2) الأدوار
--    is_staff() كان «أي ملف تعريف فعّال» — فلولا تضييقه لورث mona_admin
--    صلاحية الكتابة على منتجات الرفاعي وأسعارها لحظة إنشائه. هذا هو
--    الموضع الأمني الحرج في الملف كله.
-- ---------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role in ('admin', 'data_entry')
  );
$$;

-- مدير المنى. مدير الرفاعي داخل فيه لأنه الأعلى صلاحية.
create or replace function public.is_mona_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role in ('admin', 'mona_admin')
  );
$$;


-- ---------------------------------------------------------------------
-- 3) جداول المنى
--    صف التجاوز يُكتب عند التعديل فقط. غياب الصف = ظاهر بالنسبة العامة،
--    وهو ما يجعل كل كتالوج الرفاعي معروضاً في المنى من اللحظة الأولى
--    بلا أي إدخال.
-- ---------------------------------------------------------------------
create table if not exists public.mona_product_overrides (
  product_id     uuid primary key references public.products(id) on delete cascade,
  is_visible     boolean not null default true,
  price_override bigint check (price_override is null or price_override >= 0),
  is_offer       boolean not null default false,
  updated_at     timestamptz not null default now()
);

-- إخفاء صنف كامل بضغطة: الرفاعي يبيع مواد منزلية وأدوات حلاقة لا محل لها هنا.
create table if not exists public.mona_category_overrides (
  category_id int primary key references public.categories(id) on delete cascade,
  is_visible  boolean not null default true,
  sort_order  int
);

create table if not exists public.mona_ads (
  id         serial primary key,
  title      text not null,
  subtitle   text,
  image_url  text,
  href       text,
  sort_order int     not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 4) الإعدادات — في app_settings القائم، بلا جدول جديد
--    do nothing وليس do update: إعادة تشغيل الملف يجب ألا تمسح نسبة
--    الربح التي ضبطها المالك.
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, updated_at) values
  ('mona_markup_percent',   '25',  now()),   -- نسبة الربح على سعر الجملة
  ('mona_round_to',         '250', now()),   -- تقريب لأعلى بالدينار
  ('mona_store_url',        '',    now()),
  ('mona_telegram_chat_id', '',    now())
on conflict (key) do nothing;

-- قراءة إعداد رقمي بأمان: قيمة تالفة تُعيد الافتراضي ولا تُسقط المتجر.
create or replace function public.mona_num(p_key text, p_default numeric)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select value into v from public.app_settings where key = p_key;
  if v is null or trim(v) = '' then return p_default; end if;
  return v::numeric;
exception when others then return p_default;
end $$;


-- ---------------------------------------------------------------------
-- 5) معادلة سعر المنى — في مكان واحد يستعمله العرض والدالة معاً
--    منتج رفاعي: الجملة + النسبة، مقرّبة لأعلى. الجملة هي الأساس لأنها
--                ما يُحسب عليه الربح؛ ولو كانت 0 نرجع لسعر المفرد.
--    منتج منى:   السعر كما أدخلته إدارة المنى، بلا نسبة.
--    السعر 0 يبقى «عند الطلب» كما في الرفاعي.
-- ---------------------------------------------------------------------
create or replace function public.mona_price(
  p_wholesale bigint, p_retail bigint, p_override bigint,
  p_store text, p_markup numeric, p_round numeric
) returns bigint language sql immutable as $$
  select case
    when p_override is not null then p_override
    when p_store = 'mona'       then coalesce(p_retail, 0)
    when coalesce(nullif(p_wholesale, 0), p_retail, 0) = 0 then 0::bigint
    else ceil(
           coalesce(nullif(p_wholesale, 0), p_retail) * (100 + coalesce(p_markup, 0)) / 100.0
           / greatest(coalesce(p_round, 1), 1)
         )::bigint * greatest(coalesce(p_round, 1), 1)::bigint
  end;
$$;



-- ---------------------------------------------------------------------
-- 7) واجهة متجر المنى
--    العرض مكشوف لـ anon فكل عمود فيه علنيّ — لذا لا price_wholesale
--    ولا store ولا sold_by. غياب sold_by هو ما يجعل المنى بالقطعة دائماً:
--    الواجهة لا ترى «دزينة» أصلاً.
-- ---------------------------------------------------------------------
create or replace view public.mona_storefront_products
with (security_invoker = off) as
  select p.id, p.code, p.name, p.category_id, c.name as category,
         p.image_url, p.quantity_single, p.created_at,
         (p.quantity_single > 0)     as in_stock,
         coalesce(o.is_offer, false) as is_offer,
         public.mona_price(
           pr.price_wholesale, pr.price_retail, o.price_override, p.store,
           s.markup, s.round_to
         ) as price_retail
    from public.products p
    join public.categories c      on c.id = p.category_id
    join public.product_prices pr on pr.product_id = p.id
    left join public.mona_product_overrides  o  on o.product_id  = p.id
    left join public.mona_category_overrides co on co.category_id = p.category_id
    -- الإعدادات تُقرأ مرة واحدة للاستعلام كله لا مرة لكل منتج
    cross join (select public.mona_num('mona_markup_percent', 25) as markup,
                       public.mona_num('mona_round_to',      250) as round_to) s
   where p.is_active = true
     and coalesce(o.is_visible,  true)
     and coalesce(co.is_visible, true);

grant select on public.mona_storefront_products to anon, authenticated;

-- أصناف المنى: ما فيه منتج ظاهر واحد على الأقل — فلا يظهر صنف فارغ.
create or replace view public.mona_categories
with (security_invoker = off) as
  select c.id, c.name,
         coalesce(co.sort_order, c.sort_order) as sort_order,
         count(m.id) as product_count
    from public.categories c
    join public.mona_storefront_products m on m.category_id = c.id
    left join public.mona_category_overrides co on co.category_id = c.id
   group by c.id, c.name, co.sort_order, c.sort_order;

grant select on public.mona_categories to anon, authenticated;


-- ---------------------------------------------------------------------
-- 8) عرض لوحة إدارة المنى
--    security_invoker = on عمداً: الصلاحية تُفحص على الجداول الأصلية،
--    فـ anon يحصل على صفر صفوف مهما حاول. هنا وحده تظهر أسعار الجملة
--    والربح المحسوب.
-- ---------------------------------------------------------------------
create or replace view public.mona_admin_products
with (security_invoker = on) as
  select p.id, p.code, p.barcode, p.name, p.category_id, c.name as category,
         p.store, p.image_url, p.quantity_single, p.is_active, p.created_at,
         pr.price_wholesale, pr.price_retail as rifai_retail,
         o.price_override,
         coalesce(o.is_visible, true) as is_visible,
         coalesce(o.is_offer,  false) as is_offer,
         public.mona_price(
           pr.price_wholesale, pr.price_retail, o.price_override, p.store,
           s.markup, s.round_to
         ) as mona_price
    from public.products p
    join public.categories c      on c.id = p.category_id
    join public.product_prices pr on pr.product_id = p.id
    left join public.mona_product_overrides o on o.product_id = p.id
    cross join (select public.mona_num('mona_markup_percent', 25) as markup,
                       public.mona_num('mona_round_to',      250) as round_to) s;

grant select on public.mona_admin_products to authenticated;


-- ---------------------------------------------------------------------
-- 9) طلبات المنى
-- ---------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add  constraint orders_source_check
  check (source in ('storefront', 'telegram', 'pos', 'mona'));

-- نسخة create_order بثلاثة فروق: السعر من عرض المنى، source ثابت 'mona'،
-- ولا معامل mode (المنى تجزئة فقط). المتصفح يرسل {product_id, qty} فقط —
-- حصن منع التلاعب كما هو ولا يُمسّ.
create or replace function public.mona_create_order(
  p_customer_name  text,
  p_customer_phone text,
  p_items          jsonb,
  p_zone_id        int  default null,
  p_note           text default null
)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_item  jsonb;
  v_line  jsonb;
  v_id    uuid;
  v_qty   int;
  v_price bigint;
  v_name  text;
  v_code  text;
  v_bar   text;
  v_stock int;
  v_sub   bigint := 0;
  v_fee   bigint := 0;
  v_zone  text;
  v_ask   boolean := false;
  v_lines jsonb  := '[]'::jsonb;
  v_order public.orders;
begin
  if p_zone_id is not null then
    select name, fee into v_zone, v_fee
      from public.delivery_zones where id = p_zone_id and is_active;
    if v_zone is null then
      raise exception 'منطقة التوصيل غير متاحة';
    end if;
  else
    raise exception 'الرجاء اختيار منطقة التوصيل';
  end if;

  if p_customer_name is null or length(trim(p_customer_name)) < 2 then
    raise exception 'الرجاء إدخال اسم الزبونة';
  end if;
  if p_customer_phone is null or length(regexp_replace(p_customer_phone, '\D', '', 'g')) < 10 then
    raise exception 'الرجاء إدخال رقم هاتف صحيح';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception 'قائمة المنتجات غير صالحة';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_id := (v_item->>'product_id')::uuid;
    exception when others then
      raise exception 'معرّف منتج غير صالح';
    end;

    v_qty := (v_item->>'qty')::int;
    if v_qty is null or v_qty <= 0 or v_qty > 1000 then
      raise exception 'كمية غير صالحة';
    end if;

    -- السعر من عرض المنى: يطبّق النسبة والسعر المثبّت، ويستبعد المخفيّ تلقائياً
    select m.price_retail, m.name, m.code, p.barcode, m.quantity_single
      into v_price, v_name, v_code, v_bar, v_stock
      from public.mona_storefront_products m
      join public.products p on p.id = m.id
     where m.id = v_id;

    if v_price is null then
      raise exception 'أحد المنتجات لم يعد متوفراً في المتجر';
    end if;
    if v_stock < v_qty then
      raise exception 'الكمية المطلوبة من «%» غير متوفرة (المتوفر: % قطعة)', v_name, v_stock;
    end if;

    if v_price = 0 then v_ask := true; end if;

    v_sub := v_sub + v_price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'product_id',       v_id,
      'code',             v_code,
      'barcode',          v_bar,
      'name',             v_name,
      'qty',              v_qty,
      'unit_price',       v_price,
      'line_total',       v_price * v_qty,
      'price_on_request', (v_price = 0));
  end loop;

  insert into public.orders (customer_name, customer_phone, mode, subtotal,
                             delivery_zone, delivery_fee, customer_note,
                             total_amount, items_json, source)
  values (trim(p_customer_name), trim(p_customer_phone), 'retail', v_sub,
          v_zone, v_fee, nullif(trim(coalesce(p_note, '')), ''),
          v_sub + v_fee, v_lines, 'mona')
  returning * into v_order;

  -- المخزون واحد فعلياً: بيع المنى ينقص رفّ الرفاعي، وهذا هو المقصود.
  for v_line in select * from jsonb_array_elements(v_lines) loop
    insert into public.stock_movements
      (product_id, type, singles_qty, source, order_id, note)
    values ((v_line->>'product_id')::uuid, 'sale', -(v_line->>'qty')::int,
            'order', v_order.id, 'طلب المنى #' || v_order.order_number);
  end loop;

  return jsonb_build_object(
    'order_id',          v_order.id,
    'order_number',      v_order.order_number,
    'subtotal',          v_order.subtotal,
    'delivery_zone',     v_order.delivery_zone,
    'delivery_fee',      v_order.delivery_fee,
    'total_amount',      v_order.total_amount,
    'has_price_request', v_ask,
    'items',             v_order.items_json);
end $fn$;

revoke all on function public.mona_create_order(text, text, jsonb, int, text) from public;
grant execute on function public.mona_create_order(text, text, jsonb, int, text) to anon, authenticated;



-- ---------------------------------------------------------------------
-- 11) الصلاحيات — كل طرف على صفوفه
-- ---------------------------------------------------------------------

-- المنتجات: طاقم الرفاعي يكتب على 'rifai'، ومدير المنى على 'mona'.
-- القراءة متبادلة: المنى يحتاج رؤية كتالوج الرفاعي ومخزونه.
drop policy if exists "products_staff_insert" on public.products;
create policy "products_staff_insert" on public.products
  for insert with check (public.is_staff() and store = 'rifai');

drop policy if exists "products_staff_update" on public.products;
create policy "products_staff_update" on public.products
  for update using (public.is_staff() and store = 'rifai')
          with check (public.is_staff() and store = 'rifai');

drop policy if exists "products_admin_delete" on public.products;
create policy "products_admin_delete" on public.products
  for delete using (public.is_admin() and store = 'rifai');

drop policy if exists "products_mona_read" on public.products;
create policy "products_mona_read" on public.products
  for select using (public.is_mona_admin());

drop policy if exists "products_mona_write" on public.products;
create policy "products_mona_write" on public.products
  for all using (public.is_mona_admin() and store = 'mona')
          with check (public.is_mona_admin() and store = 'mona');

-- الأسعار: مدير المنى يقرأ الجملة كلها (يحتاجها ليرى ربحه)،
-- ولا يكتب إلا على أسعار منتجاته.
drop policy if exists "prices_mona_read" on public.product_prices;
create policy "prices_mona_read" on public.product_prices
  for select using (public.is_mona_admin());

drop policy if exists "prices_mona_write" on public.product_prices;
create policy "prices_mona_write" on public.product_prices
  for all using (
    public.is_mona_admin() and exists (
      select 1 from public.products p where p.id = product_id and p.store = 'mona')
  ) with check (
    public.is_mona_admin() and exists (
      select 1 from public.products p where p.id = product_id and p.store = 'mona')
  );

-- الأصناف: القراءة عامة أصلاً؛ الكتابة للمنى على أصنافها فقط.
drop policy if exists "categories_mona_write" on public.categories;
create policy "categories_mona_write" on public.categories
  for all using (public.is_mona_admin() and store = 'mona')
          with check (public.is_mona_admin() and store = 'mona');

-- حركات المخزون: سجل تدقيق دائم — إضافة وقراءة فقط، لا تعديل ولا حذف.
drop policy if exists "movements_mona_read" on public.stock_movements;
create policy "movements_mona_read" on public.stock_movements
  for select using (public.is_mona_admin());

drop policy if exists "movements_mona_insert" on public.stock_movements;
create policy "movements_mona_insert" on public.stock_movements
  for insert with check (
    public.is_mona_admin() and exists (
      select 1 from public.products p where p.id = product_id and p.store = 'mona')
  );

-- الطلبات: المنى يرى ويعدّل طلباته وحدها. مدير الرفاعي يرى الكل بسياسته القائمة.
drop policy if exists "orders_mona_read" on public.orders;
create policy "orders_mona_read" on public.orders
  for select using (public.is_mona_admin() and source = 'mona');

drop policy if exists "orders_mona_update" on public.orders;
create policy "orders_mona_update" on public.orders
  for update using (public.is_mona_admin() and source = 'mona')
          with check (public.is_mona_admin() and source = 'mona');

-- جداول المنى
alter table public.mona_product_overrides  enable row level security;
alter table public.mona_category_overrides enable row level security;
alter table public.mona_ads                enable row level security;

drop policy if exists "mona_overrides_admin" on public.mona_product_overrides;
create policy "mona_overrides_admin" on public.mona_product_overrides
  for all using (public.is_mona_admin()) with check (public.is_mona_admin());

drop policy if exists "mona_cat_overrides_admin" on public.mona_category_overrides;
create policy "mona_cat_overrides_admin" on public.mona_category_overrides
  for all using (public.is_mona_admin()) with check (public.is_mona_admin());

drop policy if exists "mona_ads_read" on public.mona_ads;
create policy "mona_ads_read" on public.mona_ads
  for select using (is_active or public.is_mona_admin());

drop policy if exists "mona_ads_admin" on public.mona_ads;
create policy "mona_ads_admin" on public.mona_ads
  for all using (public.is_mona_admin()) with check (public.is_mona_admin());

grant select on public.mona_ads to anon, authenticated;

-- الإعدادات: مدير المنى يقرأ ويكتب مفاتيح mona_ وحدها — لا توكن البوت
-- ولا رابط الرفاعي.
drop policy if exists "settings_mona" on public.app_settings;
create policy "settings_mona" on public.app_settings
  for all using (public.is_mona_admin() and key like 'mona\_%')
          with check (public.is_mona_admin() and key like 'mona\_%');

-- الصور: مدير المنى يرفع لمنتجاته في نفس الـ bucket.
drop policy if exists "images_mona_upload" on storage.objects;
create policy "images_mona_upload" on storage.objects
  for insert with check (bucket_id = 'product-images' and public.is_mona_admin());

drop policy if exists "images_mona_update" on storage.objects;
create policy "images_mona_update" on storage.objects
  for update using (bucket_id = 'product-images' and public.is_mona_admin());


create or replace view public.mona_popular_products
with (security_invoker = off) as
  select (it->>'product_id')::uuid as product_id,
         sum((it->>'qty')::int)::bigint as qty_sold
    from public.orders o, jsonb_array_elements(o.items_json) it
   where o.status <> 'cancelled'
     and o.source = 'mona'
     and (it->>'product_id') is not null
   group by 1;

grant select on public.mona_popular_products to anon, authenticated;
