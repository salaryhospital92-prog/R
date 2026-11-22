-- =====================================================================
-- أسواق الرفاعي — الجزء الثاني: العمليات المالية والمخزنية
-- المصاريف · المشتريات · الديون · الفواتير · تقارير المبيعات
--
-- نفّذه في SQL Editor **بعد** schema.sql. قابل لإعادة التنفيذ بأمان.
-- كل المبالغ بالدينار العراقي كأعداد صحيحة bigint.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) توسعة الطلبات: مصدر الطلب + البيع بالآجل
--    الفاتورة = الطلب. لا جدول فواتير موازٍ — رقم الطلب هو رقم الفاتورة.
-- ---------------------------------------------------------------------
alter table public.orders add column if not exists source       text   not null default 'storefront';
alter table public.orders add column if not exists payment      text   not null default 'cash';
alter table public.orders add column if not exists discount     bigint not null default 0;

do $$ begin
  alter table public.orders add constraint orders_source_check
    check (source in ('storefront', 'telegram', 'pos'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.orders add constraint orders_payment_check
    check (payment in ('cash', 'debt'));       -- نقد أو آجل (دَين)
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------
-- 2) المصاريف
-- ---------------------------------------------------------------------
create table if not exists public.expense_categories (
  id         serial primary key,
  name       text not null unique,
  sort_order int  not null default 0
);

insert into public.expense_categories (name, sort_order) values
  ('إيجار', 1), ('كهرباء ومولدة', 2), ('رواتب', 3), ('نقل وتوصيل', 4),
  ('صيانة', 5), ('دعاية', 6), ('ضيافة', 7), ('أخرى', 8)
on conflict (name) do nothing;

create table if not exists public.expenses (
  id          bigserial primary key,
  category_id int    references public.expense_categories(id),
  amount      bigint not null check (amount > 0),
  note        text,
  spent_on    date   not null default current_date,
  created_by  uuid   references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists idx_expenses_date on public.expenses (spent_on desc);


-- ---------------------------------------------------------------------
-- 3) المشتريات من الموردين — تأكيد الفاتورة يُدخل البضاعة للمخزون
-- ---------------------------------------------------------------------
create table if not exists public.suppliers (
  id         serial primary key,
  name       text not null unique,
  phone      text,
  note       text,
  created_at timestamptz not null default now()
);

do $$ begin
  create type public.purchase_status as enum ('draft', 'received', 'cancelled');
exception when duplicate_object then null; end $$;

create sequence if not exists public.purchase_number_seq start 500;

create table if not exists public.purchases (
  id              uuid primary key default gen_random_uuid(),
  purchase_number bigint not null unique default nextval('public.purchase_number_seq'),
  supplier_id     int    references public.suppliers(id),
  supplier_name   text,                                    -- لقطة الاسم وقت الشراء
  total_amount    bigint not null default 0 check (total_amount >= 0),
  payment         text   not null default 'cash' check (payment in ('cash', 'debt')),
  status          public.purchase_status not null default 'draft',
  note            text,
  created_by      uuid   references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now()
);

create table if not exists public.purchase_items (
  id          bigserial primary key,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text   not null,                     -- لقطة الاسم
  dozen_qty   int    not null default 0 check (dozen_qty >= 0),
  singles_qty int    not null default 0 check (singles_qty >= 0),
  qty         int    generated always as (dozen_qty * 12 + singles_qty) stored,
  unit_cost   bigint not null default 0 check (unit_cost >= 0),
  created_at  timestamptz not null default now()
);

create index if not exists idx_purchase_items_purchase on public.purchase_items (purchase_id);

-- تأكيد استلام فاتورة الشراء يُدخل كل بنودها للمخزون دفعة واحدة،
-- وإلغاؤها بعد الاستلام يُخرجها. المرور دائماً عبر stock_movements.
create or replace function public.apply_purchase_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_sign int;
begin
  if (new.status = 'received') = (old.status = 'received') then
    return new;
  end if;
  v_sign := case when new.status = 'received' then 1 else -1 end;

  for r in select * from public.purchase_items where purchase_id = new.id and product_id is not null loop
    insert into public.stock_movements (product_id, type, dozen_qty, singles_qty, source, note)
    values (r.product_id, 'stock_in', 0, v_sign * r.qty, 'purchase',
            case when v_sign = 1 then 'استلام فاتورة شراء #' else 'إلغاء فاتورة شراء #' end
              || new.purchase_number);
  end loop;
  return new;
end $$;

drop trigger if exists trg_apply_purchase_status on public.purchases;
create trigger trg_apply_purchase_status
  after update of status on public.purchases
  for each row execute function public.apply_purchase_status();

-- إجمالي الفاتورة يُحسب من بنودها، لا من إدخال يدوي
create or replace function public.recalc_purchase_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.purchase_id, old.purchase_id);
begin
  update public.purchases
     set total_amount = coalesce((select sum(qty * unit_cost) from public.purchase_items where purchase_id = v_id), 0)
   where id = v_id;
  return null;
end $$;

drop trigger if exists trg_recalc_purchase_total on public.purchase_items;
create trigger trg_recalc_purchase_total
  after insert or update or delete on public.purchase_items
  for each row execute function public.recalc_purchase_total();


-- ---------------------------------------------------------------------
-- 4) دفتر الديون — للزبائن (لنا) وللموردين (علينا)
-- ---------------------------------------------------------------------
create table if not exists public.debts (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'receivable'
                check (kind in ('receivable', 'payable')),  -- لنا / علينا
  party_name    text   not null,
  party_phone   text,
  amount        bigint not null check (amount > 0),
  note          text,
  order_id      uuid references public.orders(id)    on delete set null,
  purchase_id   uuid references public.purchases(id) on delete set null,
  due_on        date,
  settled_at    timestamptz,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create table if not exists public.debt_payments (
  id         bigserial primary key,
  debt_id    uuid   not null references public.debts(id) on delete cascade,
  amount     bigint not null check (amount > 0),
  note       text,
  paid_on    date   not null default current_date,
  created_by uuid   references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists idx_debts_open on public.debts (kind, settled_at, due_on);
create index if not exists idx_debt_payments_debt on public.debt_payments (debt_id);

-- المتبقي من كل دَين، وحالة التأخير
create or replace view public.debts_view
with (security_invoker = on) as
  select d.*,
         coalesce(p.paid, 0) as paid,
         d.amount - coalesce(p.paid, 0) as remaining,
         (d.settled_at is null and d.due_on is not null and d.due_on < current_date) as overdue
    from public.debts d
    left join (
      select debt_id, sum(amount) as paid from public.debt_payments group by debt_id
    ) p on p.debt_id = d.id;

-- تسوية الدَين تلقائياً عند اكتمال السداد
create or replace function public.settle_debt_if_paid()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.debt_id, old.debt_id); v_amount bigint; v_paid bigint;
begin
  select amount into v_amount from public.debts where id = v_id;
  select coalesce(sum(amount), 0) into v_paid from public.debt_payments where debt_id = v_id;
  update public.debts
     set settled_at = case when v_paid >= v_amount then now() else null end
   where id = v_id;
  return null;
end $$;

drop trigger if exists trg_settle_debt on public.debt_payments;
create trigger trg_settle_debt
  after insert or update or delete on public.debt_payments
  for each row execute function public.settle_debt_if_paid();

-- طلب بالآجل يفتح دَيناً تلقائياً على الزبون
create or replace function public.debt_from_order()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment = 'debt' and new.total_amount > 0 then
    insert into public.debts (kind, party_name, party_phone, amount, order_id, note)
    values ('receivable', new.customer_name, new.customer_phone, new.total_amount, new.id,
            'طلب #' || new.order_number);
  end if;
  return new;
end $$;

drop trigger if exists trg_debt_from_order on public.orders;
create trigger trg_debt_from_order
  after insert on public.orders
  for each row execute function public.debt_from_order();


-- ---------------------------------------------------------------------
-- 5) تقارير — دوال يستدعيها البوت واللوحة
-- ---------------------------------------------------------------------

-- ملخّص مالي لفترة: مبيعات، مصاريف، مشتريات، ديون
create or replace function public.finance_summary(p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'orders_count',   (select count(*) from public.orders
                        where status <> 'cancelled' and created_at::date between p_from and p_to),
    'sales_goods',    (select coalesce(sum(subtotal), 0) from public.orders
                        where status <> 'cancelled' and created_at::date between p_from and p_to),
    'sales_delivery', (select coalesce(sum(delivery_fee), 0) from public.orders
                        where status <> 'cancelled' and created_at::date between p_from and p_to),
    'sales_total',    (select coalesce(sum(total_amount), 0) from public.orders
                        where status <> 'cancelled' and created_at::date between p_from and p_to),
    'sales_cash',     (select coalesce(sum(total_amount), 0) from public.orders
                        where status <> 'cancelled' and payment = 'cash'
                          and created_at::date between p_from and p_to),
    'sales_debt',     (select coalesce(sum(total_amount), 0) from public.orders
                        where status <> 'cancelled' and payment = 'debt'
                          and created_at::date between p_from and p_to),
    'expenses',       (select coalesce(sum(amount), 0) from public.expenses
                        where spent_on between p_from and p_to),
    'purchases',      (select coalesce(sum(total_amount), 0) from public.purchases
                        where status = 'received' and created_at::date between p_from and p_to),
    'debts_open',     (select coalesce(sum(remaining), 0) from public.debts_view
                        where kind = 'receivable' and settled_at is null),
    'debts_overdue',  (select coalesce(sum(remaining), 0) from public.debts_view
                        where kind = 'receivable' and settled_at is null and overdue)
  );
$$;

-- أكثر المنتجات مبيعاً في فترة
create or replace function public.top_products(p_from date, p_to date, p_limit int default 10)
returns table (name text, qty bigint, revenue bigint)
language sql stable security invoker set search_path = public as $$
  select it->>'name' as name,
         sum((it->>'qty')::int)::bigint as qty,
         sum((it->>'line_total')::bigint)::bigint as revenue
    from public.orders o, jsonb_array_elements(o.items_json) it
   where o.status <> 'cancelled' and o.created_at::date between p_from and p_to
   group by 1 order by 2 desc limit p_limit;
$$;

-- قائمة نواقص المخزون — أساس فاتورة مشتريات
create or replace function public.low_stock(p_threshold int default 12)
returns table (id uuid, name text, category text, quantity_single int)
language sql stable security invoker set search_path = public as $$
  select p.id, p.name, c.name, p.quantity_single
    from public.products p
    left join public.categories c on c.id = p.category_id
   where p.is_active and p.quantity_single <= p_threshold
   order by p.quantity_single, p.name;
$$;


-- ---------------------------------------------------------------------
-- 6) وكلاء التيليغرام: دور لكل وكيل، وحالة المحادثة للمعالجات المتعددة الخطوات
-- ---------------------------------------------------------------------
alter table public.telegram_agents
  add column if not exists role public.user_role not null default 'data_entry';

create table if not exists public.telegram_sessions (
  chat_id    bigint primary key,
  state      jsonb  not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.telegram_sessions enable row level security;
drop policy if exists "tg_sessions_admin" on public.telegram_sessions;
create policy "tg_sessions_admin" on public.telegram_sessions
  for all using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 7) سياسات RLS
-- ---------------------------------------------------------------------
alter table public.expense_categories enable row level security;
alter table public.expenses           enable row level security;
alter table public.suppliers          enable row level security;
alter table public.purchases          enable row level security;
alter table public.purchase_items     enable row level security;
alter table public.debts              enable row level security;
alter table public.debt_payments      enable row level security;

-- المال كله للمدير وحده — موظف الإدخال لا يرى مصروفاً ولا دَيناً ولا كلفة شراء
do $$
declare t text;
begin
  foreach t in array array['expenses', 'suppliers', 'purchases', 'purchase_items', 'debts', 'debt_payments']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format(
      'create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())',
      t || '_admin', t);
  end loop;
end $$;

drop policy if exists "expense_categories_read" on public.expense_categories;
create policy "expense_categories_read" on public.expense_categories
  for select using (public.is_admin());

drop policy if exists "expense_categories_admin" on public.expense_categories;
create policy "expense_categories_admin" on public.expense_categories
  for all using (public.is_admin()) with check (public.is_admin());

grant select on public.debts_view to authenticated;

grant execute on function public.finance_summary(date, date) to authenticated;
grant execute on function public.top_products(date, date, int)  to authenticated;
grant execute on function public.low_stock(int)                 to authenticated;

-- =====================================================================
-- تم. الفاتورة = الطلب (order_number هو رقم الفاتورة)، والمخزون لا يتغيّر
-- إلا عبر stock_movements — بيعاً كان أو شراءً أو تصحيحاً.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 8) دعوات البوت — إضافة مدير/مشرف برمز لمرة واحدة
--    أفضل من مطاردة معرّف تيليغرام: المدير يولّد رمزاً ويرسله للشخص،
--    والشخص يرسل الرمز للبوت فيُسجَّل بالدور المحدد. الرمز يُستهلك مرة واحدة.
-- ---------------------------------------------------------------------
create table if not exists public.telegram_invites (
  code       text primary key,
  role       public.user_role not null default 'data_entry',
  label      text,
  created_by bigint,                         -- telegram_id للمدير المُصدِر
  expires_at timestamptz not null default now() + interval '24 hours',
  used_by    bigint,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

alter table public.telegram_invites enable row level security;
drop policy if exists "tg_invites_admin" on public.telegram_invites;
create policy "tg_invites_admin" on public.telegram_invites
  for all using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 9) وحدة البيع: بعض البضاعة لا تُباع بالدرزن — تُباع بالقطعة فقط
--    'dozen' = يُباع بالدرزن (الجملة تُحسب بالدرزن، خطوة الكمية 12)
--    'piece' = يُباع بالقطعة فقط (خطوة الكمية 1 حتى في وضع الجملة)
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists sold_by text not null default 'dozen';

do $$ begin
  alter table public.products add constraint products_sold_by_check
    check (sold_by in ('dozen', 'piece'));
exception when duplicate_object then null; end $$;

drop view if exists public.storefront_products;
create view public.storefront_products
with (security_invoker = off) as
  select p.id,
         p.name,
         p.category_id,
         c.name as category,
         p.image_url,
         p.quantity_single,
         p.sold_by,
         (p.quantity_single > 0) as in_stock,
         pr.price_retail,
         pr.price_wholesale
    from public.products p
    join public.categories c      on c.id = p.category_id
    join public.product_prices pr on pr.product_id = p.id
   where p.is_active = true;

grant select on public.storefront_products to anon, authenticated;


-- ---------------------------------------------------------------------
-- 10) تسعير بند «يُحدَّد عند التأكيد» داخل طلب قائم
--     المدير يضع السعر عند تأكيد الطلب، فتُحدَّث لقطة البنود والمجاميع
--     في القاعدة نفسها — لا حساب في المتصفح.
-- ---------------------------------------------------------------------
create or replace function public.price_order_item(
  p_order_id   uuid,
  p_product_id uuid,
  p_unit_price bigint,
  p_save_to_product boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
  v_items jsonb := '[]'::jsonb;
  v_line  jsonb;
  v_sub   bigint := 0;
  v_hit   boolean := false;
begin
  if not public.is_admin() then
    raise exception 'هذه العملية للمدير فقط';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'سعر غير صالح';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'الطلب غير موجود';
  end if;

  for v_line in select * from jsonb_array_elements(v_order.items_json) loop
    if (v_line->>'product_id')::uuid = p_product_id then
      v_hit  := true;
      v_line := v_line
        || jsonb_build_object(
             'unit_price',       p_unit_price,
             'line_total',       p_unit_price * (v_line->>'qty')::int,
             'price_on_request', (p_unit_price = 0));
    end if;
    v_sub   := v_sub + (v_line->>'line_total')::bigint;
    v_items := v_items || v_line;
  end loop;

  if not v_hit then
    raise exception 'البند غير موجود في هذا الطلب';
  end if;

  update public.orders
     set items_json   = v_items,
         subtotal     = v_sub,
         total_amount = v_sub + delivery_fee
   where id = p_order_id
  returning * into v_order;

  -- خيار: اعتماد السعر للمنتج نفسه ليظهر في المتجر مستقبلاً
  if p_save_to_product then
    update public.product_prices
       set price_retail = case when v_order.mode = 'retail'    then p_unit_price else price_retail end,
           price_wholesale = case when v_order.mode = 'wholesale' then p_unit_price else price_wholesale end,
           updated_at = now()
     where product_id = p_product_id;
  end if;

  return jsonb_build_object(
    'subtotal',     v_order.subtotal,
    'delivery_fee', v_order.delivery_fee,
    'total_amount', v_order.total_amount,
    'items',        v_order.items_json);
end $$;

grant execute on function public.price_order_item(uuid, uuid, bigint, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 11) رمز قصير لكل منتج — لصفحته المستقلة alrifai.shop/p/K7M2QX
--     أبجدية بلا حروف ملتبسة (O/0 و I/1) ليسهل قراءتها هاتفياً.
-- ---------------------------------------------------------------------
create or replace function public.gen_product_code()
returns text language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 32) + 1)::int, 1), '')
  from generate_series(1, 6);
$$;

alter table public.products
  add column if not exists code text default public.gen_product_code();

-- تعبئة المنتجات القديمة، وضمان عدم التكرار
update public.products set code = public.gen_product_code() where code is null;

do $$ begin
  alter table public.products add constraint products_code_key unique (code);
exception when duplicate_table or duplicate_object then null; end $$;

alter table public.products alter column code set not null;

drop view if exists public.storefront_products;
create view public.storefront_products
with (security_invoker = off) as
  select p.id,
         p.code,
         p.name,
         p.category_id,
         c.name as category,
         p.image_url,
         p.quantity_single,
         p.sold_by,
         (p.quantity_single > 0) as in_stock,
         pr.price_retail,
         pr.price_wholesale
    from public.products p
    join public.categories c      on c.id = p.category_id
    join public.product_prices pr on pr.product_id = p.id
   where p.is_active = true;

grant select on public.storefront_products to anon, authenticated;


-- ---------------------------------------------------------------------
-- 12) تصحيح ثانٍ لأسعار الجملة + ما تحتاجه الصفحة الرئيسية الجديدة
--     السبب الجذري كان محرّر المنتج في اللوحة: كان يحفظ حقل الجملة كما هو
--     بلا قسمة على 12، بخلاف شاشة الأسعار والبوت. أُصلح في الواجهة، وهذا
--     تصحيح للبيانات التي دخلت قبله.
-- ---------------------------------------------------------------------
do $$ declare r record; n int; begin
  raise notice '── منتجات ملتبسة (الجملة أغلى لكن دون 5× المفرد) — لم تُمَس ──';
  for r in select p.name, pr.price_retail rt, pr.price_wholesale wh
             from public.products p join public.product_prices pr on pr.product_id = p.id
            where p.sold_by = 'dozen' and pr.price_wholesale > 0
              and pr.price_wholesale > pr.price_retail
              and pr.price_wholesale < pr.price_retail * 5
            order by p.name loop
    raise notice '  ⚠️ % | مفرد % | جملة %', r.name, r.rt, r.wh;
  end loop;

  raise notice '── منتجات بلا سعر مفرد لكن لها سعر جملة — لم تُمَس ──';
  for r in select p.name, pr.price_wholesale wh
             from public.products p join public.product_prices pr on pr.product_id = p.id
            where pr.price_retail = 0 and pr.price_wholesale > 0 order by p.name loop
    raise notice '  ⚠️ % | جملة %', r.name, r.wh;
  end loop;

  update public.product_prices pr
     set price_wholesale = round(pr.price_wholesale / 12.0), updated_at = now()
    from public.products p
   where p.id = pr.product_id and p.sold_by = 'dozen'
     and pr.price_retail > 0 and pr.price_wholesale >= pr.price_retail * 5;
  get diagnostics n = row_count;
  raise notice '✅ صُحّح % منتج (قُسمت الجملة على 12)', n;
end $$;

-- منتج مميّز — يعلّمه المالك يدوياً ليتصدّر «الأكثر طلباً»
alter table public.products
  add column if not exists is_featured boolean not null default false;

create index if not exists idx_products_featured on public.products (is_featured) where is_featured;

-- العرض العام: أُضيف تاريخ الإضافة (لقسم «الجديدة») وعلامة التمييز
drop view if exists public.storefront_products;
create view public.storefront_products
with (security_invoker = off) as
  select p.id, p.code, p.name, p.category_id, c.name as category,
         p.image_url, p.quantity_single, p.sold_by, p.is_featured, p.created_at,
         (p.quantity_single > 0) as in_stock,
         pr.price_retail, pr.price_wholesale
    from public.products p
    join public.categories c      on c.id = p.category_id
    join public.product_prices pr on pr.product_id = p.id
   where p.is_active = true;

grant select on public.storefront_products to anon, authenticated;

-- الأكثر مبيعاً — يكشف معرّف المنتج وعدد المبيع فقط، لا زبائن ولا مبالغ
drop view if exists public.popular_products;
create view public.popular_products
with (security_invoker = off) as
  select (it->>'product_id')::uuid as product_id,
         sum((it->>'qty')::int)::bigint as qty_sold
    from public.orders o, jsonb_array_elements(o.items_json) it
   where o.status <> 'cancelled'
     and (it->>'product_id') is not null
   group by 1;

grant select on public.popular_products to anon, authenticated;


-- ---------------------------------------------------------------------
-- 13) وحدة إدخال سعر الجملة — تُحفظ لكل منتج
--     كانت الوحدة تُشتقّ ضمناً من sold_by، فمن بيده سعر القطعة لمنتج يُباع
--     بالدرزن لم يجد إلا خانة معنونة «سعر الدرزن» — فنشأت أخطاء ×12.
--     الآن الوحدة صريحة ومحفوظة، و price_wholesale يبقى مخزَّناً للقطعة
--     كما هو، فلا يتغيّر شيء في create_order ولا في حسابات المتجر.
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists price_unit text not null default 'dozen';

do $$ begin
  alter table public.products add constraint products_price_unit_check
    check (price_unit in ('dozen', 'piece'));
exception when duplicate_object then null; end $$;

-- تعبئة أولية من وحدة البيع الحالية حتى لا يتغيّر أي عرض عند الترقية
update public.products set price_unit = sold_by where price_unit is distinct from sold_by;


-- ---------------------------------------------------------------------
-- 14) تمييز البنود المتشابهة عند التجهيز
--     عشرة منتجات تحمل أسماء متطابقة («واقي شمس ☀» مرّتين مثلاً). كانت لقطة
--     البند تحمل product_id فقط — رقم طويل لا يُقرأ في رسالة — فلا يعرف
--     المجهِّز أيّ نوع يأخذ من الرفّ. الآن كل بند يحمل رمزه القصير وباركوده.
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, updated_at)
values ('store_url', 'https://alrifai.shop', now())
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function public.create_order(
  p_customer_name  text,
  p_customer_phone text,
  p_items          jsonb,
  p_mode           text default 'retail',
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
           p.name, p.code, p.barcode, p.quantity_single
      into v_price, v_name, v_code, v_bar, v_stock
      from public.products p
      join public.product_prices pr on pr.product_id = p.id
     where p.id = v_id and p.is_active = true;

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
      'code',             v_code,   -- رمز صفحة المنتج: يميّز المتشابهات
      'barcode',          v_bar,    -- ما هو مطبوع على العلبة في الرفّ
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
end $fn$;

revoke all on function public.create_order(text, text, jsonb, text, int, text) from public;
grant execute on function public.create_order(text, text, jsonb, text, int, text) to anon, authenticated;


-- إشعار التيليغرام يحمل رابط كل منتج وباركوده ليفتحه المجهِّز ويرى صورته
create or replace function public.notify_new_order()
returns trigger language plpgsql security definer
set search_path = public, extensions as $fn$
declare
  v_token text; v_chat text; v_site text;
  v_line jsonb; v_items text := ''; v_qty text; v_i int := 0;
begin
  select value into v_token from public.app_settings where key = 'telegram_bot_token';
  select value into v_chat  from public.app_settings where key = 'telegram_chat_id';
  select value into v_site  from public.app_settings where key = 'store_url';
  if coalesce(v_token, '') = '' or coalesce(v_chat, '') = '' then
    return new;
  end if;

  for v_line in select * from jsonb_array_elements(new.items_json) loop
    v_i := v_i + 1;
    v_qty := case when new.mode = 'wholesale' and (v_line->>'qty')::int % 12 = 0
                  then to_char((v_line->>'qty')::int / 12, 'FM999,999') || ' درزن'
                  else to_char((v_line->>'qty')::int, 'FM999,999') || ' قطعة' end;

    v_items := v_items || v_i || '. ' || (v_line->>'name') || ' — ' || v_qty ||
      case when (v_line->>'price_on_request')::boolean then ' — السعر عند الطلب'
           else ' = ' || to_char((v_line->>'line_total')::bigint, 'FM999,999,999') || ' د.ع' end
      || E'\n';

    -- سطر التمييز: الرابط يفتح صورة المنتج، والباركود مطبوع على العلبة
    if (v_line->>'code') is not null then
      v_items := v_items || '   🔗 ' || coalesce(v_site, '') || '/p/' || (v_line->>'code');
      if (v_line->>'barcode') is not null then
        v_items := v_items || '  ·  ' || (v_line->>'barcode');
      end if;
      v_items := v_items || E'\n';
    end if;
  end loop;

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
      'chat_id', v_chat,
      'disable_web_page_preview', true,
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
  return new;
end $fn$;


-- ---------------------------------------------------------------------
-- 15) تقرير مبيعات يومي متكامل — تلقائي إلى تيليغرام كل يوم 23:59 بغداد
--     الحدود بتوقيت بغداد (UTC+3 بلا توقيت صيفي) لا بتوقيت الخادم (UTC)،
--     وإلا كانت طلبات 00:00–02:59 بغداد تُحسب على اليوم السابق خطأً.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron with schema extensions;

create or replace function public.send_daily_sales_report()
returns void language plpgsql security definer
set search_path = public, extensions as $fn$
declare
  v_token text; v_chat text;
  v_date  date := (now() at time zone 'Asia/Baghdad')::date;
  v_ystd  date := v_date - 1;
  tz constant text := 'Asia/Baghdad';

  v_orders int; v_delivered int; v_confirmed int; v_new int; v_cancelled int;
  v_goods bigint; v_delivery bigint; v_total bigint; v_cash bigint; v_debt bigint;
  v_expenses bigint; v_purchases bigint; v_net bigint;
  v_total_ystd bigint;
  v_debts_open bigint; v_debts_overdue bigint;
  v_low_count int;
  v_top text;
  v_money text;
begin
  select value into v_token from public.app_settings where key = 'telegram_bot_token';
  select value into v_chat  from public.app_settings where key = 'telegram_chat_id';
  if coalesce(v_token, '') = '' or coalesce(v_chat, '') = '' then
    return;
  end if;

  v_money := 'FM999,999,999,999';

  select
    count(*) filter (where status <> 'cancelled'),
    count(*) filter (where status = 'delivered'),
    count(*) filter (where status = 'confirmed'),
    count(*) filter (where status = 'new'),
    count(*) filter (where status = 'cancelled'),
    coalesce(sum(subtotal)      filter (where status <> 'cancelled'), 0),
    coalesce(sum(delivery_fee)  filter (where status <> 'cancelled'), 0),
    coalesce(sum(total_amount)  filter (where status <> 'cancelled'), 0),
    coalesce(sum(total_amount)  filter (where status <> 'cancelled' and payment = 'cash'), 0),
    coalesce(sum(total_amount)  filter (where status <> 'cancelled' and payment = 'debt'), 0)
    into v_orders, v_delivered, v_confirmed, v_new, v_cancelled,
         v_goods, v_delivery, v_total, v_cash, v_debt
  from public.orders
  where (created_at at time zone tz)::date = v_date;

  select coalesce(sum(total_amount), 0) into v_total_ystd
  from public.orders
  where status <> 'cancelled' and (created_at at time zone tz)::date = v_ystd;

  select coalesce(sum(amount), 0) into v_expenses
  from public.expenses where spent_on = v_date;

  select coalesce(sum(total_amount), 0) into v_purchases
  from public.purchases where status = 'received' and (created_at at time zone tz)::date = v_date;

  v_net := v_total - v_expenses - v_purchases;

  select coalesce(sum(remaining), 0),
         coalesce(sum(remaining) filter (where overdue), 0)
    into v_debts_open, v_debts_overdue
  from public.debts_view where kind = 'receivable' and settled_at is null;

  select count(*) into v_low_count
  from public.products where is_active and quantity_single <= 12;

  select coalesce(string_agg(
    format('%s. %s — %s قطعة (%s د.ع)', rn, name, qty, to_char(revenue, v_money)), E'\n' order by rn), '—')
    into v_top
  from (
    select row_number() over (order by revenue desc) rn, name, qty, revenue
    from (
      select it->>'name' as name, sum((it->>'qty')::int) qty, sum((it->>'line_total')::bigint) revenue
        from public.orders o, jsonb_array_elements(o.items_json) it
       where o.status <> 'cancelled' and (o.created_at at time zone tz)::date = v_date
       group by it->>'name'
    ) agg
    order by revenue desc
    limit 5
  ) t;

  perform net.http_post(
    url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
      'chat_id', v_chat,
      'parse_mode', 'HTML',
      'text',
        '📊 <b>التقرير اليومي — أسواق الرفاعي</b>' || E'\n' ||
        '<code>' || to_char(v_date, 'YYYY-MM-DD') || '</code>' || E'\n\n' ||

        '🧾 الطلبات: <b>' || v_orders || '</b>' ||
        ' (🟢 ' || v_delivered || ' مُسلَّم · 🟠 ' || v_confirmed || ' مؤكد · 🔵 ' || v_new || ' جديد)' ||
        (case when v_cancelled > 0 then ' · 🔴 ' || v_cancelled || ' ملغى' else '' end) || E'\n\n' ||

        '📦 بضاعة: ' || to_char(v_goods, v_money) || E'\n' ||
        '🚚 توصيل: ' || to_char(v_delivery, v_money) || E'\n' ||
        '💰 <b>إجمالي المبيعات: ' || to_char(v_total, v_money) || '</b>' || E'\n' ||
        '   ├ نقد: ' || to_char(v_cash, v_money) || E'\n' ||
        '   └ آجل: ' || to_char(v_debt, v_money) || E'\n\n' ||

        '💸 مصاريف اليوم: ' || to_char(v_expenses, v_money) || E'\n' ||
        '📥 مشتريات مستلَمة اليوم: ' || to_char(v_purchases, v_money) || E'\n' ||
        '━━━━━━━━━━━━' || E'\n' ||
        (case when v_net >= 0 then '📈' else '📉' end) || ' <b>الصافي: ' || to_char(v_net, v_money) || '</b>' || E'\n\n' ||

        '🏆 <b>الأكثر مبيعاً اليوم</b>' || E'\n' || v_top || E'\n\n' ||

        '💳 ديون مفتوحة لنا: <b>' || to_char(v_debts_open, v_money) || '</b>' ||
        (case when v_debts_overdue > 0 then E'\n⚠️ منها متأخر: <b>' || to_char(v_debts_overdue, v_money) || '</b>' else '' end) ||
        (case when v_low_count > 0 then E'\n⚠️ نواقص المخزون: <b>' || v_low_count || '</b> صنف' else '' end) || E'\n\n' ||

        '↔️ مقارنة بالأمس: ' ||
        (case
           when v_total_ystd = 0 and v_total = 0 then 'بلا مبيعات في اليومين'
           when v_total_ystd = 0 then '+' || to_char(v_total, v_money) || ' (لا مبيعات أمس)'
           else to_char(round(((v_total - v_total_ystd)::numeric / v_total_ystd) * 100), 'FM999') ||
                '% ' || (case when v_total >= v_total_ystd then '📈' else '📉' end)
         end)
    )
  );
end $fn$;

revoke all on function public.send_daily_sales_report() from public;

-- 23:59 بغداد = 20:59 UTC (توقيت الخادم)، بلا توقيت صيفي في العراق
select cron.unschedule(jobid) from cron.job where jobname = 'daily-sales-report';
select cron.schedule('daily-sales-report', '59 20 * * *', $$select public.send_daily_sales_report()$$);


-- ---------------------------------------------------------------------
-- 16) الربط مع شركة التوصيل «زاد» (ZAD Integrations API v1)
--
-- الاتفاق: الكابتن يمرّ على المحل أولاً ويدفع ثمن البضاعة، ثم يوصّل ويحصّل
-- من الزبون. لذا يُستدعى عند جاهزية الطلب المؤكَّد (زرّ يدوي)، لا عند التأكيد.
--
-- لماذا داخل قاعدة البيانات: السرّ لا يجوز أن يصل المتصفح، والخادم يتصل
-- بزاد مباشرة عبر امتداد http. المفاتيح في جدول zad_config بلا أي سياسة RLS،
-- فلا يقرؤه إلا ما تعرّفه الدوال نفسها — لا المتصفح ولا لوحة الإدارة.
--
-- مفتاح الأمان zad_dispatch يبدأ مطفأً: لا يُستدعى كابتن قبل أن يُشعَل.
-- ---------------------------------------------------------------------
create extension if not exists http with schema extensions;

alter table public.delivery_zones add column if not exists zad_zone_id text unique;

-- ---- إعدادات سرّية: لا سياسة = لا وصول من المتصفح إطلاقاً -------------
create table if not exists public.zad_config (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.zad_config enable row level security;
revoke all on public.zad_config from anon, authenticated;

insert into public.zad_config (key, value) values
  ('client_id', ''), ('client_secret', ''),
  ('dispatch', 'off'),                  -- off | on : مفتاح الاستدعاء
  ('token', ''), ('token_exp', '0'), ('mode', '')
on conflict (key) do nothing;

-- ---- رحلات زاد ---------------------------------------------------------
create table if not exists public.zad_deliveries (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  zad_order_id   text not null unique,
  summon_number  text,
  status         text not null,        -- searching assigned picked_up delivered failed cancelled on_hold
  captain        jsonb,
  cancel_reason  text,
  cash_to_collect bigint not null,     -- ثمن البضاعة فقط — زاد تضيف الأجرة بنفسها
  delivery_fee   bigint not null,      -- أجرة زاد التي يدفعها الزبون للكابتن
  mode           text not null,        -- test | live
  notified_status text,
  last_polled_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- رحلة نشطة واحدة فقط لكل طلب
create unique index if not exists uq_zad_active_per_order on public.zad_deliveries (order_id)
  where status in ('searching', 'assigned', 'picked_up', 'on_hold');

alter table public.zad_deliveries enable row level security;
drop policy if exists "zad_deliveries_admin" on public.zad_deliveries;
create policy "zad_deliveries_admin" on public.zad_deliveries
  for select using (public.is_admin());

-- ---- أدوات داخلية ------------------------------------------------------
create or replace function public.zad_cfg(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select value from public.zad_config where key = p_key;
$$;

create or replace function public.zad_set(p_key text, p_val text) returns void
language sql security definer set search_path = public as $$
  update public.zad_config set value = p_val, updated_at = now() where key = p_key;
$$;

/** رقم الزبون بالصيغة التي تطلبها زاد: 9647XXXXXXXXX (13 رقماً، بلا + ولا صفر) */
create or replace function public.zad_canonical_phone(p text) returns text
language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d ~ '^9647\d{9}$' then return d; end if;
  if d ~ '^07\d{9}$'   then return '964' || substr(d, 2); end if;
  if d ~ '^7\d{9}$'    then return '964' || d; end if;
  return null;
end $$;

create or replace function public.zad_label(p_order_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when source = 'mona' then 'المنى #' else '#' end || order_number
    from public.orders where id = p_order_id;
$$;

create or replace function public.zad_tg(p_text text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text; v_chat text;
begin
  select value into v_token from public.app_settings where key = 'telegram_bot_token';
  select value into v_chat  from public.app_settings where key = 'telegram_chat_id';
  if coalesce(v_token, '') = '' or coalesce(v_chat, '') = '' then return; end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('chat_id', v_chat, 'text', p_text, 'disable_web_page_preview', true));
exception when others then null;
end $$;

-- ---- المفتاح المؤقت (ساعة) — يُخزَّن ولا يُطلب لكل استدعاء --------------
create or replace function public.zad_token(p_force boolean default false) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id text := public.zad_cfg('client_id');
  v_secret text := public.zad_cfg('client_secret');
  v_tok text := public.zad_cfg('token');
  v_exp bigint := coalesce(nullif(public.zad_cfg('token_exp'), '')::bigint, 0);
  r extensions.http_response; j jsonb;
begin
  if not p_force and v_tok <> '' and v_exp > extract(epoch from now())::bigint + 120 then
    return v_tok;
  end if;
  if v_id = '' or v_secret = '' then
    raise exception 'لم تُضبط بيانات الربط مع زاد بعد';
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '15');
  r := extensions.http_post('https://api.zad-apps.com/v1/auth/token',
         jsonb_build_object('client_id', v_id, 'client_secret', v_secret)::text, 'application/json');
  begin j := r.content::jsonb; exception when others then j := '{}'::jsonb; end;

  if r.status <> 200 then
    raise exception 'رفضت زاد بيانات الدخول (%): %', r.status, coalesce(j->'error'->>'code', j->>'code', 'غير معروف');
  end if;

  perform public.zad_set('token', j->>'access_token');
  perform public.zad_set('token_exp',
    (extract(epoch from now())::bigint + coalesce((j->>'expires_in')::int, 3600))::text);
  perform public.zad_set('mode', coalesce(j->>'mode', ''));
  return j->>'access_token';
end $$;

/** استدعاء خام لزاد. يعيد {status, body}. ينعش المفتاح مرة واحدة عند 401. */
create or replace function public.zad_req(p_method text, p_path text,
                                          p_body jsonb default null, p_idem text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  r extensions.http_response; v_tok text; v_try int := 0; j jsonb;
begin
  loop
    v_try := v_try + 1;
    v_tok := public.zad_token(v_try > 1);
    perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '15');
    r := extensions.http((
      p_method, 'https://api.zad-apps.com' || p_path,
      array_remove(array[
        extensions.http_header('authorization', 'Bearer ' || v_tok),
        case when p_idem is not null then extensions.http_header('idempotency-key', p_idem) end
      ], null),
      'application/json', coalesce(p_body::text, '')
    )::extensions.http_request);
    exit when r.status <> 401 or v_try >= 2;
  end loop;

  begin j := r.content::jsonb; exception when others then j := jsonb_build_object('raw', left(r.content, 200)); end;
  return jsonb_build_object('status', r.status, 'body', j);
end $$;

-- ---- مزامنة المناطق وأجورها من زاد -------------------------------------
create or replace function public.zad_sync_zones_internal() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  res jsonb; z jsonb; n int := 0; v_order int := 100;
begin
  res := public.zad_req('GET', '/v1/zones');
  if (res->>'status')::int <> 200 then
    raise exception 'تعذّر جلب المناطق من زاد (%)', res->>'status';
  end if;

  for z in select * from jsonb_array_elements(res->'body'->'zones') loop
    v_order := v_order + 1;
    -- مرتبطة سابقاً ← حدّث الاسم والأجرة
    update public.delivery_zones
       set name = z->>'name_ar', fee = (z->>'delivery_fee_iqd')::bigint
     where zad_zone_id = z->>'id';
    if not found then
      -- بالاسم نفسه ← اربطها وخذ أجرة زاد (الزبون يدفع أجرة زاد للكابتن)
      insert into public.delivery_zones (name, fee, sort_order, is_active, zad_zone_id)
      values (z->>'name_ar', (z->>'delivery_fee_iqd')::bigint, v_order, true, z->>'id')
      on conflict (name) do update
        set zad_zone_id = excluded.zad_zone_id, fee = excluded.fee;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---- واجهة المدير ------------------------------------------------------
create or replace function public.zad_status() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'للمدير فقط'; end if;
  return jsonb_build_object(
    'configured', public.zad_cfg('client_id') <> '' and public.zad_cfg('client_secret') <> '',
    'dispatch',   public.zad_cfg('dispatch') = 'on',
    'mode',       nullif(public.zad_cfg('mode'), ''),
    'zones_linked', (select count(*) from public.delivery_zones where zad_zone_id is not null));
end $$;

create or replace function public.zad_set_dispatch(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'للمدير فقط'; end if;
  perform public.zad_set('dispatch', case when p_on then 'on' else 'off' end);
end $$;

-- بزرّ المدير: تُجلب المناطق وتُعطَّل التي ليست عند زاد (ما أجرته 0 — الاستلام من المحل — يبقى).
-- المزامنة الليلية لا تعطّل شيئاً، فمنطقة يضيفها المدير يدوياً لا تختفي فجأة.
drop function if exists public.zad_sync_zones();
create or replace function public.zad_sync_zones() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; d int;
begin
  if not public.is_admin() then raise exception 'للمدير فقط'; end if;
  n := public.zad_sync_zones_internal();
  update public.delivery_zones set is_active = false
   where zad_zone_id is null and fee > 0 and is_active;
  get diagnostics d = row_count;
  return jsonb_build_object('synced', n, 'disabled', d);
end $$;

/** من يستدعي كابتن زاد: المدير للكل، مدير المنى لطلبات المنى، والمشرف لطلبات الرفاعي.
    (is_supervisor معرَّفة في migrations/002 — تُحلّ عند التشغيل لا عند الإنشاء.) */
create or replace function public.zad_can(p_source text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return public.is_admin()
      or (p_source = 'mona' and coalesce(public.is_mona_admin(), false))
      or (p_source is distinct from 'mona' and coalesce(public.is_supervisor(), false));
end $$;
revoke all on function public.zad_can(text) from public, anon, authenticated;

/** استدعاء كابتن لطلب مؤكَّد وجاهز. الكابتن يدفع ثمن البضاعة عند المحل ويحصّله من الزبون. */
create or replace function public.zad_dispatch(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  o public.orders; v_zone public.delivery_zones; v_phone text; v_cash bigint;
  v_attempt int; res jsonb; b jsonb; d jsonb; v_note text;
begin
  if public.zad_cfg('dispatch') <> 'on' then
    raise exception 'استدعاء الكابتن مطفأ — أشعله من الإعدادات أولاً';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if not public.zad_can(o.source) then
    raise exception 'غير مسموح';
  end if;
  if o.status <> 'confirmed' then raise exception 'أكّد الطلب أولاً ثم استدعِ الكابتن عند جاهزيته'; end if;
  if exists (select 1 from public.zad_deliveries
              where order_id = o.id and status in ('searching','assigned','picked_up','on_hold')) then
    raise exception 'يوجد كابتن مستدعى لهذا الطلب بالفعل';
  end if;
  if exists (select 1 from jsonb_array_elements(o.items_json) i where (i->>'price_on_request')::boolean) then
    raise exception 'في الطلب بند بلا سعر — سعّره أولاً ليُعرف المبلغ الذي يحصّله الكابتن';
  end if;

  select * into v_zone from public.delivery_zones where name = o.delivery_zone;
  if not found or v_zone.zad_zone_id is null then
    raise exception 'منطقة «%» غير مرتبطة بزاد — حدّث المناطق أو اختر منطقة أخرى', o.delivery_zone;
  end if;

  v_phone := public.zad_canonical_phone(o.customer_phone);
  if v_phone is null then raise exception 'رقم هاتف الزبون غير صالح للتوصيل: %', o.customer_phone; end if;

  v_cash := o.total_amount - o.delivery_fee;           -- البضاعة فقط (بعد الخصم)
  select count(*) + 1 into v_attempt from public.zad_deliveries where order_id = o.id;
  v_note := left(trim(concat('طلب #', o.order_number, coalesce(' — ' || o.customer_note, ''))), 500);

  res := public.zad_req('POST', '/v1/orders', jsonb_build_object(
      'zone_id', v_zone.zad_zone_id,
      'customer_name', left(o.customer_name, 120),
      'customer_phone', v_phone,
      'customer_note', v_note,
      'cash_to_collect_iqd', v_cash,
      'external_ref', o.order_number::text),
    'rifai-' || o.order_number || '-' || v_attempt);

  b := res->'body';
  if (res->>'status')::int not in (200, 201) then
    if coalesce(b->'error'->>'code', b->>'code') = 'zone_not_deliverable' then
      perform public.zad_sync_zones_internal();
      raise exception 'زاد لا توصّل لهذه المنطقة حالياً — حُدِّثت المناطق، جرّب مرة أخرى';
    end if;
    raise exception 'رفضت زاد الطلب (%): %', res->>'status', coalesce(b->'error'->>'message', b->>'message', b->'error'->>'code', b->>'code', b::text);
  end if;

  d := b->'drops'->0;
  insert into public.zad_deliveries
    (order_id, zad_order_id, summon_number, status, captain, cash_to_collect, delivery_fee, mode, notified_status)
  values (o.id, b->>'id', b->>'summon_number', b->>'status', b->'captain', v_cash,
          coalesce((d->>'delivery_fee_iqd')::bigint, v_zone.fee), coalesce(b->>'mode', 'live'), b->>'status');

  perform public.zad_tg(format(E'📞 استُدعي كابتن زاد للطلب %s\nالمنطقة: %s\nيحصّل من الزبون: %s + أجرة التوصيل %s\nرقم الاستدعاء: %s',
    public.zad_label(o.id), o.delivery_zone, to_char(v_cash, 'FM999,999,999'),
    to_char(coalesce((d->>'delivery_fee_iqd')::bigint, v_zone.fee), 'FM999,999,999'), b->>'summon_number'));

  return jsonb_build_object('summon_number', b->>'summon_number', 'status', b->>'status',
                            'mode', b->>'mode', 'delivery_fee', coalesce((d->>'delivery_fee_iqd')::bigint, v_zone.fee));
end $$;

/** إلغاء الاستدعاء — ممكن فقط ما دامت زاد تبحث عن كابتن */
create or replace function public.zad_cancel(p_order_id uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare dv public.zad_deliveries; res jsonb; v_src text;
begin
  select source into v_src from public.orders where id = p_order_id;
  if not public.zad_can(v_src) then
    raise exception 'غير مسموح';
  end if;
  select * into dv from public.zad_deliveries
   where order_id = p_order_id and status in ('searching','assigned','picked_up','on_hold') for update;
  if not found then raise exception 'لا استدعاء نشط لهذا الطلب'; end if;

  res := public.zad_req('POST', '/v1/orders/' || dv.zad_order_id || '/cancel',
                        jsonb_build_object('reason', 'ألغاه المتجر'));
  if (res->>'status')::int = 409 then
    raise exception 'قبله كابتن بالفعل — لا يُلغى من هنا، اتصل بزاد';
  elsif (res->>'status')::int not in (200, 201) then
    raise exception 'تعذّر الإلغاء عند زاد (%)', res->>'status';
  end if;
  update public.zad_deliveries
     set status = 'cancelled', cancel_reason = 'ألغاه المتجر', updated_at = now()
   where id = dv.id;
end $$;

-- ---- النبض: يتابع الرحلات المفتوحة كل دقيقة، ولا يتصل بزاد إن لم يكن شيء مفتوحاً
create or replace function public.zad_poll() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  dv public.zad_deliveries; res jsonb; b jsonb; n int := 0; v_no text; msg text;
begin
  for dv in
    select * from public.zad_deliveries
     where status in ('searching','assigned','picked_up','on_hold')
     order by created_at limit 20
  loop
    begin
      res := public.zad_req('GET', '/v1/orders/' || dv.zad_order_id);
      continue when (res->>'status')::int <> 200;
      b := res->'body';

      update public.zad_deliveries
         set status = b->>'status', captain = b->'captain', summon_number = coalesce(b->>'summon_number', summon_number),
             cancel_reason = b->>'cancel_reason', last_polled_at = now(), updated_at = now()
       where id = dv.id;
      n := n + 1;

      if b->>'status' is distinct from dv.notified_status then
        v_no := public.zad_label(dv.order_id);
        msg := case b->>'status'
          when 'assigned'  then format(E'🛵 كابتن زاد بالطريق للمحل — طلب %s\nرقم الاستدعاء: %s\nالكابتن: %s · %s',
                                v_no, dv.summon_number, b->'captain'->>'name', coalesce(b->'captain'->>'phone', '—'))
          when 'picked_up' then format('📦 استلم الكابتن الطلب %s وهو بالطريق للزبون', v_no)
          when 'delivered' then format('✅ سُلِّم الطلب %s للزبون', v_no)
          when 'failed'    then format('⚠️ فشل تسليم الطلب %s (الزبون لا يردّ أو رفض) — اتصل به', v_no)
          when 'cancelled' then format('⚠️ أُلغي استدعاء الطلب %s%s', v_no,
                                case when b->>'cancel_reason' = 'no_rider_found'
                                     then ' — لم يقبله أي كابتن خلال ساعة، أعد الاستدعاء أو اتصل بالزبون' else '' end)
          when 'on_hold'   then format('⏸ طلب %s عند دعم زاد (استثناء) — لا إجراء منك', v_no)
        end;
        if msg is not null then perform public.zad_tg(msg); end if;
        update public.zad_deliveries set notified_status = b->>'status' where id = dv.id;

        if b->>'status' = 'delivered' then
          update public.orders set status = 'delivered' where id = dv.order_id and status = 'confirmed';
        end if;
      end if;
    exception when others then
      -- متابعة رحلة واحدة لا تُسقط البقية
      update public.zad_deliveries set last_polled_at = now() where id = dv.id;
    end;
  end loop;
  return n;
end $$;

-- صلاحيات: الداخلي لا يصل إليه أحد من المتصفح
drop policy if exists "zad_deliveries_mona" on public.zad_deliveries;
create policy "zad_deliveries_mona" on public.zad_deliveries
  for select using (
    coalesce(public.is_mona_admin(), false)
    and exists (select 1 from public.orders o where o.id = order_id and o.source = 'mona'));

revoke all on function public.zad_label(uuid) from public, anon, authenticated;
revoke all on function public.zad_cfg(text), public.zad_set(text, text), public.zad_tg(text),
  public.zad_token(boolean), public.zad_req(text, text, jsonb, text),
  public.zad_sync_zones_internal(), public.zad_poll() from public, anon, authenticated;
revoke all on function public.zad_status(), public.zad_set_dispatch(boolean), public.zad_sync_zones(),
  public.zad_dispatch(uuid), public.zad_cancel(uuid) from public, anon;
grant execute on function public.zad_status(), public.zad_set_dispatch(boolean), public.zad_sync_zones(),
  public.zad_dispatch(uuid), public.zad_cancel(uuid) to authenticated;
grant execute on function public.zad_canonical_phone(text) to authenticated, anon;

-- النبض كل دقيقة (لا يتصل بزاد إن لم تكن رحلة مفتوحة)، ومزامنة المناطق ليلاً 03:00 بغداد
select cron.unschedule(jobid) from cron.job where jobname in ('zad-poll', 'zad-zones');
select cron.schedule('zad-poll', '* * * * *', $$select public.zad_poll()$$);
select cron.schedule('zad-zones', '0 0 * * *',
  $$select case when public.zad_cfg('client_id') <> '' then public.zad_sync_zones_internal() end$$);

-- حفظ مفاتيح زاد من لوحة الإدارة (تُكتب ولا تُقرأ أبداً) وفحص الاتصال
create or replace function public.zad_save_credentials(p_client_id text, p_client_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'للمدير فقط'; end if;
  p_client_id := trim(p_client_id); p_client_secret := trim(p_client_secret);
  if p_client_id !~ '^zad_(test|live)_[A-Za-z0-9]+$' then
    raise exception 'client_id غير صالح — يبدأ بـ zad_test_ أو zad_live_';
  end if;
  if p_client_secret !~ '^zsk_(test|live)_[A-Za-z0-9_-]+$' then
    raise exception 'client_secret غير صالح — يبدأ بـ zsk_test_ أو zsk_live_';
  end if;
  if substr(p_client_id, 5, 4) <> substr(p_client_secret, 5, 4) then
    raise exception 'المفتاحان من وضعين مختلفين (test/live)';
  end if;
  perform public.zad_set('client_id', p_client_id);
  perform public.zad_set('client_secret', p_client_secret);
  perform public.zad_set('token', ''); perform public.zad_set('token_exp', '0'); perform public.zad_set('mode', '');
  perform public.zad_set('dispatch', 'off');           -- مفتاح جديد = استدعاء مطفأ حتى تُشعله عمداً
end $$;

create or replace function public.zad_check() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'للمدير فقط'; end if;
  res := public.zad_req('GET', '/v1/me');
  if (res->>'status')::int <> 200 then
    raise exception 'فشل الفحص عند زاد (%)', res->>'status';
  end if;
  return jsonb_build_object(
    'restaurant', res->'body'->'restaurant'->>'name',
    'mode',       res->'body'->>'mode',
    'live_riders', (res->'body'->>'live_riders')::boolean);
end $$;

revoke all on function public.zad_save_credentials(text, text), public.zad_check() from public, anon;
grant execute on function public.zad_save_credentials(text, text), public.zad_check() to authenticated;
