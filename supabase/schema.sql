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

-- واجهة المتجر العام: منتجات فعّالة + سعر المفرد فقط.
-- سعر الجملة لا يظهر هنا إطلاقاً، والمنتجات بسعر 0 (لم يسعّرها المدير بعد) مخفيّة.
drop view if exists public.storefront_products;
create view public.storefront_products
with (security_invoker = off) as
  select p.id,
         p.name,
         p.category_id,
         c.name as category,
         p.image_url,
         (p.quantity_single > 0) as in_stock,
         pr.price_retail
    from public.products p
    join public.categories c      on c.id = p.category_id
    join public.product_prices pr on pr.product_id = p.id
   where p.is_active = true
     and pr.price_retail > 0;

grant select on public.storefront_products to anon, authenticated;


-- ---------------------------------------------------------------------
-- 5) حركات المخزون — سجل تدقيق لكل تغيير كمية (منطق الدزينة هنا)
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
  created_by   uuid references public.profiles(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

create index if not exists idx_movements_product on public.stock_movements (product_id, created_at desc);

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
create sequence if not exists public.order_number_seq start 1050;

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  order_number   bigint not null unique default nextval('public.order_number_seq'),
  customer_name  text   not null,
  customer_phone text   not null,
  total_amount   bigint not null check (total_amount >= 0),
  items_json     jsonb  not null,     -- لقطة مقفلة: الاسم والسعر والكمية وقت الطلب
  status         public.order_status not null default 'new',
  created_at     timestamptz not null default now()
);

create index if not exists idx_orders_created on public.orders (created_at desc);
create index if not exists idx_orders_status  on public.orders (status);


-- ---------------------------------------------------------------------
-- 7) دالة إنشاء الطلب — الحصن ضد التلاعب بالأسعار
--    المتصفح يرسل فقط (product_id, qty). الأسعار والمجموع تُقرأ وتُحسب هنا،
--    ورابط واتساب يُبنى في الواجهة من ردّ هذه الدالة حصراً.
-- ---------------------------------------------------------------------
create or replace function public.create_order(
  p_customer_name  text,
  p_customer_phone text,
  p_items          jsonb   -- [{"product_id":"...","qty":2}, ...]
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_item  jsonb;
  v_id    uuid;
  v_qty   int;
  v_price bigint;
  v_name  text;
  v_stock int;
  v_total bigint := 0;
  v_lines jsonb  := '[]'::jsonb;
  v_order public.orders;
begin
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

    -- السعر يُقرأ من قاعدة البيانات، لا من السلة
    select pr.price_retail, p.name, p.quantity_single
      into v_price, v_name, v_stock
      from public.products p
      join public.product_prices pr on pr.product_id = p.id
     where p.id = v_id and p.is_active = true and pr.price_retail > 0;

    if v_price is null then
      raise exception 'أحد المنتجات لم يعد متوفراً في المتجر';
    end if;
    if v_stock < v_qty then
      raise exception 'الكمية المطلوبة من «%» غير متوفرة حالياً', v_name;
    end if;

    v_total := v_total + v_price * v_qty;
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_id,
      'name',       v_name,
      'qty',        v_qty,
      'unit_price', v_price,
      'line_total', v_price * v_qty);
  end loop;

  insert into public.orders (customer_name, customer_phone, total_amount, items_json)
  values (trim(p_customer_name), trim(p_customer_phone), v_total, v_lines)
  returning * into v_order;

  return jsonb_build_object(
    'order_id',     v_order.id,
    'order_number', v_order.order_number,
    'total_amount', v_order.total_amount,
    'items',        v_order.items_json);
end $$;

-- الزبون غير المسجّل يستدعي هذه الدالة فقط — ولا وصول له لجدول الطلبات إطلاقاً
revoke all on function public.create_order(text, text, jsonb) from public;
grant execute on function public.create_order(text, text, jsonb) to anon, authenticated;

-- ponytail: خصم المخزون لا يتم عند إنشاء الطلب (طلب واتساب غير مؤكد بعد)،
-- بل عند تحويل الحالة إلى delivered في المرحلة 5 عبر stock_movements type='sale'.


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
