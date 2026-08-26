-- =====================================================================
-- أسواق الرفاعي — مخطط قاعدة البيانات الكامل (Supabase / PostgreSQL)
-- العراق – الأنبار – الرمادي – شارع السينما – فرع الشورجة
--
-- الاستخدام: انسخ الملف كاملاً والصقه في Supabase → SQL Editor → Run.
-- الملف قابل لإعادة التنفيذ (idempotent) بأمان.
-- كل المبالغ بالدينار العراقي كأعداد صحيحة bigint — لا كسور عشرية.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) الأنواع (ENUM)
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_role     as enum ('admin', 'data_entry');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.movement_type as enum ('stock_in', 'sale', 'adjustment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status  as enum ('new', 'confirmed', 'delivered', 'cancelled');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------
-- 1) الملفات الشخصية والأدوار
--    الدور مصدره هذا الجدول فقط — لا يُرسل من الواجهة ولا يُوثق به منها.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  role       public.user_role not null default 'data_entry',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- إنشاء صف profile تلقائياً عند تسجيل مستخدم جديد (الدور الافتراضي: data_entry)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- دالة فحص الدور — العمود الفقري لكل سياسات RLS
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

-- موظف مصرّح له (admin أو data_entry) وحسابه فعّال
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$$;


-- ---------------------------------------------------------------------
-- 2) الأصناف
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id         serial primary key,
  name       text not null unique,
  sort_order int  not null default 0
);

insert into public.categories (name, sort_order) values
  ('العطور', 1), ('منتجات البشرة', 2), ('كوزمتك', 3), ('مواد منزلية', 4),
  ('أدوات حلاقة', 5), ('معطرات', 6), ('شامبوهات', 7)
on conflict (name) do nothing;


-- ---------------------------------------------------------------------
-- 3) المنتجات — بلا أي عمود سعر إطلاقاً (الأسعار في جدول منفصل)
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  barcode         text unique,
  name            text not null check (length(trim(name)) > 0),
  category_id     int  references public.categories(id),
  image_url       text,
  quantity_single int  not null default 0 check (quantity_single >= 0),
  is_active       boolean not null default true,
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_products_barcode  on public.products (barcode);
create index if not exists idx_products_category on public.products (category_id);


-- ---------------------------------------------------------------------
-- 4) الأسعار — جدول منفصل يقرؤه المدير وحده
--    السبب: RLS في Postgres تعمل على مستوى الصفوف لا الأعمدة، ففصل الأسعار
--    هو الطريقة الموثوقة الوحيدة لمنع موظف الإدخال من رؤيتها من الخادم أصلاً.
-- ---------------------------------------------------------------------
create table if not exists public.product_prices (
  product_id      uuid primary key references public.products(id) on delete cascade,
  price_wholesale bigint not null default 0 check (price_wholesale >= 0), -- سعر الجملة IQD
  price_retail    bigint not null default 0 check (price_retail    >= 0), -- سعر المفرد IQD
  updated_at      timestamptz not null default now()
);

-- كل منتج جديد يحصل تلقائياً على صف أسعار بقيمة 0.
-- ضروري: موظف الإدخال ممنوع من الكتابة في product_prices (RLS)، فلو لم يُنشأ
-- الصف تلقائياً لبقي المنتج بلا سجل سعر ولفشل عرضه وطلبه.
create or replace function public.ensure_price_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.product_prices (product_id) values (new.id)
  on conflict (product_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_ensure_price_row on public.products;
create trigger trg_ensure_price_row
  after insert on public.products
  for each row execute function public.ensure_price_row();

-- واجهة المتجر العام.
-- قرار المالك: الزبون يختار «جملة» أو «مفرد» عند دخول المتجر، فالسعران معروضان.
--   تنبيه معلوم ومقبول من المالك: أي زائر يستطيع اختيار وضع الجملة ورؤية أسعار
--   الجملة. لإقفالها لاحقاً خلف رمز يُعطى لزبائن الجملة: احذف price_wholesale من
--   هذا العرض وأنشئ دالة wholesale_catalog(p_code text) تتحقق من الرمز.
-- والسعر 0 يعني «السعر عند الطلب» — المنتج يظهر ويُطلب ويُسعّره المدير عند التأكيد.
drop view if exists public.storefront_products;
create view public.storefront_products
with (security_invoker = off) as
  select p.id,
         p.name,
         p.category_id,
         c.name as category,
         p.image_url,
         p.quantity_single,                       -- تحتاجه السلة لتحديد سقف الكمية
         (p.quantity_single > 0) as in_stock,
         pr.price_retail,                          -- 0 = السعر عند الطلب
         pr.price_wholesale                        -- 0 = السعر عند الطلب
    from public.products p
    join public.categories c      on c.id = p.category_id
    join public.product_prices pr on pr.product_id = p.id
   where p.is_active = true;

grant select on public.storefront_products to anon, authenticated;


-- ---------------------------------------------------------------------
-- 5) حركات المخزون — سجل تدقيق لكل تغيير كمية (منطق الدرزن هنا)
--    لا تُعدَّل products.quantity_single يدوياً أبداً — فقط عبر هذا الجدول.
-- ---------------------------------------------------------------------
create table if not exists public.stock_movements (
  id           bigserial primary key,
  product_id   uuid not null references public.products(id) on delete cascade,
  type         public.movement_type not null,
  dozen_qty    int not null default 0 check (dozen_qty >= 0),
  singles_qty  int not null default 0,
  total_change int generated always as (dozen_qty * 12 + singles_qty) stored,
  note         text,
  source       text not null default 'dashboard',   -- dashboard | telegram_bot | order
  order_id     uuid,                                -- يُملأ لحركات البيع والإلغاء لربطها بالطلب
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

-- الجداول القديمة قد لا تحتوي العمود — أضفه عند إعادة التنفيذ
alter table public.stock_movements add column if not exists order_id uuid;

create index if not exists idx_movements_product on public.stock_movements (product_id, created_at desc);
create index if not exists idx_movements_order   on public.stock_movements (order_id);

-- تحديث كمية المنتج تلقائياً مع كل حركة؛ يمنع الرصيد السالب برسالة عربية واضحة
create or replace function public.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cur int;
begin
  -- for update يقفل صف المنتج حتى لا تتسابق حركتان على نفس الرصيد
  select quantity_single into v_cur
    from public.products where id = new.product_id for update;

  if v_cur is null then
    raise exception 'المنتج غير موجود';
  end if;
  -- الفحص قبل التحديث ليصل المستخدم خطأ عربي مفهوم بدل رسالة قيد Postgres
  if v_cur + new.total_change < 0 then
    raise exception 'الكمية المطلوبة أكبر من الرصيد المتوفر (المتوفر: % قطعة)', v_cur;
  end if;

  update public.products
     set quantity_single = v_cur + new.total_change,
         updated_at = now()
   where id = new.product_id;
  return new;
end $$;

drop trigger if exists trg_apply_stock_movement on public.stock_movements;
create trigger trg_apply_stock_movement
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();


-- ---------------------------------------------------------------------
-- 6) الطلبات — رقم متسلسل بشري + لقطة أسعار مقفلة وقت الطلب
-- ---------------------------------------------------------------------
-- مناطق التوصيل وأجورها — يقرؤها المتجر، ويديرها المدير
create table if not exists public.delivery_zones (
  id         serial primary key,
  name       text   not null unique,
  fee        bigint not null default 0 check (fee >= 0),   -- أجرة التوصيل بالدينار
  sort_order int    not null default 0,
  is_active  boolean not null default true
);

insert into public.delivery_zones (name, fee, sort_order) values
  ('الرمادي — داخل المدينة',  3000,  1),
  ('الخالدية',                5000,  2),
  ('الحبانية',                5000,  3),
  ('الفلوجة',                 7000,  4),
  ('هيت',                     8000,  5),
  ('حديثة',                  10000,  6),
  ('البغدادي',                8000,  7),
  ('عنه',                    12000,  8),
  ('راوة',                   12000,  9),
  ('القائم',                 15000, 10),
  ('الرطبة',                 15000, 11),
  ('بغداد',                  10000, 12),
  ('باقي المحافظات',         15000, 13),
  ('استلام من المحل',            0, 14)
on conflict (name) do nothing;

create sequence if not exists public.order_number_seq start 1050;

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  order_number   bigint not null unique default nextval('public.order_number_seq'),
  customer_name  text   not null,
  customer_phone text   not null,
  mode           text   not null default 'retail' check (mode in ('retail','wholesale')),
  subtotal       bigint not null default 0 check (subtotal >= 0),      -- مجموع البضاعة
  delivery_zone  text,                                                 -- لقطة اسم المنطقة
  delivery_fee   bigint not null default 0 check (delivery_fee >= 0),
  customer_note  text,                                                 -- أقرب نقطة دالة
  total_amount   bigint not null check (total_amount >= 0),            -- البضاعة + التوصيل
  items_json     jsonb  not null,     -- لقطة مقفلة: الاسم والسعر والكمية وقت الطلب
  status         public.order_status not null default 'new',
  created_at     timestamptz not null default now()
);

alter table public.orders add column if not exists mode          text   not null default 'retail';
alter table public.orders add column if not exists subtotal      bigint not null default 0;
alter table public.orders add column if not exists delivery_zone text;
alter table public.orders add column if not exists delivery_fee  bigint not null default 0;
alter table public.orders add column if not exists customer_note text;
do $$ begin
  alter table public.orders add constraint orders_mode_check
    check (mode in ('retail','wholesale'));
exception when duplicate_object then null; end $$;

create index if not exists idx_orders_created on public.orders (created_at desc);
create index if not exists idx_orders_status  on public.orders (status);

-- ربط حركات المخزون بالطلبات (يُضاف هنا لأن stock_movements أُنشئ قبل orders)
do $$ begin
  alter table public.stock_movements
    add constraint stock_movements_order_fk
    foreign key (order_id) references public.orders(id) on delete set null;
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------
-- 7) دالة إنشاء الطلب — الحصن ضد التلاعب بالأسعار
--    المتصفح يرسل فقط (product_id, qty). الأسعار والمجموع تُقرأ وتُحسب هنا،
--    ورابط واتساب يُبنى في الواجهة من ردّ هذه الدالة حصراً.
-- ---------------------------------------------------------------------
-- الوضع (mode): 'retail' مفرد أو 'wholesale' جملة — يحدد أي سعر يُقرأ.
-- أجرة التوصيل تُقرأ من delivery_zones في الخادم، لا تُرسل من المتصفح.
drop function if exists public.create_order(text, text, jsonb);
drop function if exists public.create_order(text, text, jsonb, text);

create or replace function public.create_order(
  p_customer_name  text,
  p_customer_phone text,
  p_items          jsonb,           -- [{"product_id":"...","qty":2}, ...]
  p_mode           text default 'retail',
  p_zone_id        int  default null,
  p_note           text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_item  jsonb;
  v_line  jsonb;
  v_id    uuid;
  v_qty   int;
  v_price bigint;
  v_name  text;
  v_stock int;
  v_sub   bigint := 0;
  v_fee   bigint := 0;
  v_zone  text;
  v_ask   boolean := false;   -- هل يحتوي الطلب بنداً «السعر عند الطلب»؟
  v_lines jsonb  := '[]'::jsonb;
  v_order public.orders;
begin
  if p_mode is null or p_mode not in ('retail', 'wholesale') then
    raise exception 'نوع البيع غير صالح';
  end if;

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
    raise exception 'الرجاء إدخال اسم الزبون';
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

    -- السعر يُقرأ من قاعدة البيانات حسب وضع البيع، لا من السلة
    select case when p_mode = 'wholesale' then pr.price_wholesale else pr.price_retail end,
           p.name, p.quantity_single
      into v_price, v_name, v_stock
      from public.products p
      join public.product_prices pr on pr.product_id = p.id
     where p.id = v_id and p.is_active = true;

    if v_price is null then
      raise exception 'أحد المنتجات لم يعد متوفراً في المتجر';
    end if;
    if v_stock < v_qty then
      raise exception 'الكمية المطلوبة من «%» غير متوفرة (المتوفر: % قطعة)', v_name, v_stock;
    end if;

    -- سعر 0 = «السعر عند الطلب»: البند يُحفظ ويُحجز، ويسعّره المدير عند التأكيد
    if v_price = 0 then v_ask := true; end if;

    v_sub := v_sub + v_price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'product_id',       v_id,
      'name',             v_name,
      'qty',              v_qty,
      'unit_price',       v_price,
      'line_total',       v_price * v_qty,
      'price_on_request', (v_price = 0));
  end loop;

  insert into public.orders (customer_name, customer_phone, mode, subtotal,
                             delivery_zone, delivery_fee, customer_note,
                             total_amount, items_json)
  values (trim(p_customer_name), trim(p_customer_phone), p_mode, v_sub,
          v_zone, v_fee, nullif(trim(coalesce(p_note, '')), ''),
          v_sub + v_fee, v_lines)
  returning * into v_order;

  -- قرار المالك: الخصم فور إرسال الطلب (يمنع بيع نفس القطعة مرتين).
  -- إلغاء الطلب يعيد الكمية تلقائياً عبر trg_restore_stock_on_status.
  for v_line in select * from jsonb_array_elements(v_lines) loop
    insert into public.stock_movements
      (product_id, type, singles_qty, source, order_id, note)
    values ((v_line->>'product_id')::uuid, 'sale', -(v_line->>'qty')::int,
            'order', v_order.id, 'طلب #' || v_order.order_number);
  end loop;

  return jsonb_build_object(
    'order_id',          v_order.id,
    'order_number',      v_order.order_number,
    'mode',              v_order.mode,
    'subtotal',          v_order.subtotal,
    'delivery_zone',     v_order.delivery_zone,
    'delivery_fee',      v_order.delivery_fee,
    'total_amount',      v_order.total_amount,
    'has_price_request', v_ask,
    'items',             v_order.items_json);
end $$;

-- الزبون غير المسجّل يستدعي هذه الدالة فقط — ولا وصول له لجدول الطلبات إطلاقاً
revoke all on function public.create_order(text, text, jsonb, text, int, text) from public;
grant execute on function public.create_order(text, text, jsonb, text, int, text) to anon, authenticated;


-- إلغاء الطلب يعيد الكمية للمخزون، وإعادة تفعيله تخصمها من جديد.
-- بدون هذا تتآكل أرصدة المخزون مع كل طلب ملغى.
create or replace function public.restore_stock_on_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_line jsonb; v_sign int;
begin
  if (new.status = 'cancelled') = (old.status = 'cancelled') then
    return new;                       -- لا تغيّر في حالة الإلغاء
  end if;
  v_sign := case when new.status = 'cancelled' then 1 else -1 end;

  for v_line in select * from jsonb_array_elements(new.items_json) loop
    insert into public.stock_movements
      (product_id, type, singles_qty, source, order_id, note)
    values ((v_line->>'product_id')::uuid, 'adjustment',
            v_sign * (v_line->>'qty')::int, 'order', new.id,
            case when v_sign = 1 then 'إلغاء الطلب #' else 'إعادة تفعيل الطلب #' end
              || new.order_number);
  end loop;
  return new;
end $$;

drop trigger if exists trg_restore_stock_on_status on public.orders;
create trigger trg_restore_stock_on_status
  after update of status on public.orders
  for each row execute function public.restore_stock_on_status();


-- ---------------------------------------------------------------------
-- 8) وكلاء التيليغرام المصرّح لهم (بوت الإدخال عن بُعد — المرحلة 6)
-- ---------------------------------------------------------------------
create table if not exists public.telegram_agents (
  telegram_id bigint primary key,        -- معرّف حساب التيليغرام الرقمي
  agent_name  text not null,
  profile_id  uuid references public.profiles(id),  -- لنسب الحركات لموظف معروف
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 9) تفعيل RLS على كل الجداول
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.categories      enable row level security;
alter table public.delivery_zones  enable row level security;
alter table public.products        enable row level security;
alter table public.product_prices  enable row level security;
alter table public.stock_movements enable row level security;
alter table public.orders          enable row level security;
alter table public.telegram_agents enable row level security;

-- profiles: كل موظف يرى ملفه فقط، والمدير يرى الجميع ويديرهم
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- categories: قراءة عامة (المتجر يحتاجها)، والإدارة للمدير وحده
drop policy if exists "categories_read" on public.categories;
create policy "categories_read" on public.categories for select using (true);

drop policy if exists "categories_admin" on public.categories;
create policy "categories_admin" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

-- delivery_zones: المتجر يقرأ المناطق الفعّالة، والمدير يديرها
drop policy if exists "zones_read" on public.delivery_zones;
create policy "zones_read" on public.delivery_zones for select using (is_active or public.is_admin());

drop policy if exists "zones_admin" on public.delivery_zones;
create policy "zones_admin" on public.delivery_zones
  for all using (public.is_admin()) with check (public.is_admin());

-- products: الموظفون يقرؤون ويضيفون ويعدّلون، والحذف للمدير وحده
drop policy if exists "products_staff_read" on public.products;
create policy "products_staff_read" on public.products
  for select using (public.is_staff());

drop policy if exists "products_staff_insert" on public.products;
create policy "products_staff_insert" on public.products
  for insert with check (public.is_staff());

drop policy if exists "products_staff_update" on public.products;
create policy "products_staff_update" on public.products
  for update using (public.is_staff()) with check (public.is_staff());

drop policy if exists "products_admin_delete" on public.products;
create policy "products_admin_delete" on public.products
  for delete using (public.is_admin());

-- product_prices: المدير فقط — موظف الإدخال لا يستطيع حتى القراءة
drop policy if exists "prices_admin_only" on public.product_prices;
create policy "prices_admin_only" on public.product_prices
  for all using (public.is_admin()) with check (public.is_admin());

-- stock_movements: إضافة وقراءة فقط — لا تعديل ولا حذف لأحد (سجل تدقيق دائم)
drop policy if exists "movements_staff_read" on public.stock_movements;
create policy "movements_staff_read" on public.stock_movements
  for select using (public.is_staff());

drop policy if exists "movements_staff_insert" on public.stock_movements;
create policy "movements_staff_insert" on public.stock_movements
  for insert with check (public.is_staff());

-- orders: المدير فقط يقرأ ويحدّث الحالة (الإنشاء عبر create_order حصراً — لا سياسة insert)
drop policy if exists "orders_admin_read" on public.orders;
create policy "orders_admin_read" on public.orders
  for select using (public.is_admin());

drop policy if exists "orders_admin_update" on public.orders;
create policy "orders_admin_update" on public.orders
  for update using (public.is_admin()) with check (public.is_admin());

-- telegram_agents: المدير فقط
drop policy if exists "tg_agents_admin" on public.telegram_agents;
create policy "tg_agents_admin" on public.telegram_agents
  for all using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 10) التخزين (Storage) — صور المنتجات
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "images_public_read" on storage.objects;
create policy "images_public_read" on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists "images_staff_upload" on storage.objects;
create policy "images_staff_upload" on storage.objects
  for insert with check (bucket_id = 'product-images' and public.is_staff());

drop policy if exists "images_staff_update" on storage.objects;
create policy "images_staff_update" on storage.objects
  for update using (bucket_id = 'product-images' and public.is_staff());

drop policy if exists "images_admin_delete" on storage.objects;
create policy "images_admin_delete" on storage.objects
  for delete using (bucket_id = 'product-images' and public.is_admin());


-- =====================================================================
-- بعد التنفيذ:
-- 1) أنشئ أول مستخدم من Supabase → Authentication → Users → Add user.
-- 2) رقِّه مديراً:
--      update public.profiles set role = 'admin' where id = '<USER_UUID>';
-- 3) للتحقق السريع من عمل المخطط، نفّذ ملف supabase/smoke-test.sql.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 11) إشعار التيليغرام عند وصول طلب جديد
--     pg_net يرسل الطلب لاحقاً بشكل غير متزامن، فلا يبطّئ حفظ الطلب،
--     وفشل الإرسال لا يُفشل الطلب نفسه.
-- ---------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create table if not exists public.app_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value) values
  ('telegram_bot_token', ''),   -- من @BotFather
  ('telegram_chat_id',   '')    -- معرّف المحادثة التي تصلها الإشعارات
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "settings_admin" on public.app_settings;
create policy "settings_admin" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.notify_new_order()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_token text;
  v_chat  text;
  v_line  jsonb;
  v_items text := '';
  v_qty   text;
  v_i     int  := 0;
begin
  select value into v_token from public.app_settings where key = 'telegram_bot_token';
  select value into v_chat  from public.app_settings where key = 'telegram_chat_id';
  if coalesce(v_token, '') = '' or coalesce(v_chat, '') = '' then
    return new;                       -- الإشعارات غير مضبوطة بعد — تجاهل بصمت
  end if;

  for v_line in select * from jsonb_array_elements(new.items_json) loop
    v_i := v_i + 1;
    v_qty := case when new.mode = 'wholesale'
                  then to_char((v_line->>'qty')::int / 12, 'FM999,999') || ' درزن'
                  else to_char((v_line->>'qty')::int, 'FM999,999') || ' قطعة' end;
    v_items := v_items || v_i || '. ' || (v_line->>'name') || ' — ' || v_qty ||
      case when (v_line->>'price_on_request')::boolean then ' — السعر عند الطلب'
           else ' = ' || to_char((v_line->>'line_total')::bigint, 'FM999,999,999') || ' د.ع' end
      || E'\n';
  end loop;

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
      'chat_id', v_chat,
      'text',
        '🛒 طلب جديد #' || new.order_number || E'\n' ||
        'النوع: ' || case when new.mode = 'wholesale' then 'جملة' else 'مفرد' end || E'\n' ||
        'الزبون: ' || new.customer_name || E'\n' ||
        'الهاتف: ' || new.customer_phone || E'\n' ||
        'المنطقة: ' || coalesce(new.delivery_zone, '—') || E'\n' ||
        coalesce('ملاحظة: ' || new.customer_note || E'\n', '') || E'\n' ||
        v_items || E'\n' ||
        'البضاعة: ' || to_char(new.subtotal, 'FM999,999,999') || ' د.ع' || E'\n' ||
        'التوصيل: ' || to_char(new.delivery_fee, 'FM999,999,999') || ' د.ع' || E'\n' ||
        '💰 المجموع: ' || to_char(new.total_amount, 'FM999,999,999') || ' د.ع'
    )
  );
  return new;
exception when others then
  return new;                          -- فشل الإشعار لا يُفشل الطلب أبداً
end $$;

drop trigger if exists trg_notify_new_order on public.orders;
create trigger trg_notify_new_order
  after insert on public.orders
  for each row execute function public.notify_new_order();

-- المتجر يحتاج قراءة الطلبات لحظياً في لوحة المدير (Realtime)
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;
