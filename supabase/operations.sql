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
