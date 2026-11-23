-- كمية الجملة تخصّ كل منتج بدل 12 الثابتة:
--   pack_qty      قطع علبة الجملة (sold_by='dozen'): بطارية 24، صمغ 25. تُباع علباً كاملة.
--   wholesale_min أقل كمية للجملة لما يُباع بالقطعة (sold_by='piece'): عطر من قطعتين.
--                 تسري في المفرد أيضاً: من بلغ الكمية أخذ سعر الجملة للقطعة.
--   pack_only     لا يُباع منه مفرد: العلبة كاملة في الوضعين (سيت بكرات 12 قطعة).
-- product_prices.price_dozen = ثمن العلبة كما أُدخل، أياً كان عدد قطعها.
alter table public.products
  add column if not exists pack_qty int not null default 12 check (pack_qty between 1 and 1000),
  add column if not exists wholesale_min int not null default 1 check (wholesale_min between 1 and 1000),
  add column if not exists pack_only boolean not null default false;
do $$ begin
  alter table public.products add constraint products_pack_only_check check (not pack_only or sold_by <> 'piece');
exception when duplicate_object then null; end $$;

-- price_wholesale للقطعة يُشتقّ بعدد قطع العلبة. كاتب قديم يرسله وحده ← يُشتقّ ثمن العلبة.
create or replace function public.sync_price_dozen() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pack numeric := coalesce((select pack_qty from public.products where id = new.product_id), 12);
begin
  if tg_op = 'INSERT' then
    if new.price_dozen > 0 then new.price_wholesale := round(new.price_dozen / v_pack);
    else new.price_dozen := new.price_wholesale * v_pack; end if;
  elsif new.price_dozen is not distinct from old.price_dozen
        and new.price_wholesale is distinct from old.price_wholesale then
    new.price_dozen := new.price_wholesale * v_pack;
  else
    new.price_wholesale := round(new.price_dozen / v_pack);
  end if;
  return new;
end $$;

-- تغيير عدد قطع العلبة: ثمن العلبة يبقى كما كُتب، أو سعر القطعة إن كانت هي المكتوبة.
create or replace function public.sync_pack_qty() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.price_unit = 'piece' then
    update public.product_prices set price_dozen = price_wholesale * new.pack_qty where product_id = new.id;
  else
    update public.product_prices set price_dozen = price_dozen where product_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists trg_sync_pack_qty on public.products;
create trigger trg_sync_pack_qty after update of pack_qty on public.products
  for each row when (old.pack_qty is distinct from new.pack_qty) execute function public.sync_pack_qty();

do $$
declare d text; n text; m constant text := 'لم ينطبق التعديل: ';
begin
  -- العرض العام
  d := regexp_replace(pg_get_viewdef('public.storefront_products'::regclass, true), ';\s*$', '');
  if d not like '%pack_qty%' then
    n := replace(d, E'pr.price_dozen\n', E'pr.price_dozen,\n    p.pack_qty,\n    p.wholesale_min,\n    p.pack_only\n');
    if n = d then raise exception '%', m || 'storefront_products'; end if;
    execute 'create or replace view public.storefront_products as ' || n;
  end if;

  -- الطلب
  d := pg_get_functiondef('public.create_order'::regproc);
  n := replace(d, E'  v_dozen bigint;\n', E'  v_dozen bigint;\n  v_pack int;\n  v_min int;\n  v_piece bigint;\n');
  if n = d then raise exception '%', m || '1'; end if; d := n;
  n := regexp_replace(d, 'case when p_mode = ''wholesale'' and p\.sold_by <> ''piece'' then pr\.price_dozen end\s+into v_price, v_name, v_code, v_bar, v_stock, v_dozen',
    $r$case when p.pack_only or (p_mode = 'wholesale' and p.sold_by <> 'piece') then pr.price_dozen end,
           p.pack_qty, case when p.sold_by = 'piece' then p.wholesale_min else 1 end, pr.price_wholesale
      into v_price, v_name, v_code, v_bar, v_stock, v_dozen, v_pack, v_min, v_piece$r$);
  if n = d then raise exception '%', m || '2'; end if; d := n;
  n := replace(d, 'الجملة بالدرزن: ثمن الدرزن كما أُدخل × عدد الدرازن، بلا قسمة',
                  'بالعلبة: ثمنها كما أُدخل × عدد العلب، بلا قسمة');
  d := n;
  n := regexp_replace(d, 'if v_qty % 12 <> 0 then\s+raise exception ''«%» تُباع جملةً بالدرزن \(12 قطعة\)'', v_name;\s+end if;\s+v_total := v_dozen \* \(v_qty / 12\);\s+else\s+v_total',
    $r$if v_qty % v_pack <> 0 then
        raise exception '«%» تُباع بالعلبة كاملة (% قطعة)', v_name, v_pack;
      end if;
      v_total := v_dozen * (v_qty / v_pack);
    else
      if p_mode = 'wholesale' and v_qty < v_min then
        raise exception 'أقل كمية جملة من «%» هي % قطع', v_name, v_min;
      end if;
      -- بلغ كمية الجملة في وضع المفرد ← سعر الجملة للقطعة
      if v_min > 1 and v_qty >= v_min and v_piece > 0 then v_price := v_piece; end if;
      v_total$r$);
  if n = d then raise exception '%', m || '3'; end if; d := n;
  n := regexp_replace(d, '''dozen_price'',(\s+)v_dozen,',
    '''dozen_price'',\1v_dozen,' || E'\n      ''pack_qty'',         case when v_dozen is not null then v_pack end,');
  if n = d then raise exception '%', m || '4'; end if;
  execute n;

  -- إشعار البوت: «2 علبة (24 قطعة)» بدل عدّ الدرازن بالقسمة على 12
  d := pg_get_functiondef('public.notify_new_order'::regproc);
  n := replace(d, $a$v_qty := case when new.mode$a$,
    $b$v_qty := case when v_line ? 'pack_qty' then
                       case when v_line->>'pack_qty' is null then to_char((v_line->>'qty')::int, 'FM999,999') || ' قطعة'
                            when (v_line->>'pack_qty')::int = 12 then to_char((v_line->>'qty')::int / 12, 'FM999,999') || ' درزن'
                            else to_char((v_line->>'qty')::int / (v_line->>'pack_qty')::int, 'FM999,999') || ' علبة (' || (v_line->>'pack_qty') || ' قطعة)' end
                  when new.mode$b$);
  if n = d then raise exception '%', m || 'notify_new_order'; end if;
  execute n;
end $$;

-- المنتجات الأربعة كما حدّدها المالك
do $$
declare v_id uuid;
begin
  select id into strict v_id from public.products where store='rifai' and is_active and name = 'بطارية فيستل قلم وريمونت';
  update public.products set pack_qty = 24 where id = v_id;
  update public.product_prices set price_dozen = 5000 where product_id = v_id;

  select id into strict v_id from public.products where store='rifai' and is_active and name = 'صمغ اضافر 401';
  update public.products set pack_qty = 25 where id = v_id;
  update public.product_prices set price_dozen = 18000 where product_id = v_id;

  select id into strict v_id from public.products where store='rifai' and is_active and name = 'سيت بكرات خياطه الوان أبيض أو أسود';
  update public.products set pack_only = true where id = v_id;
  update public.product_prices set price_dozen = 1500, price_retail = 0 where product_id = v_id;

  -- 102000 للدرزن = 8500 للقطعة بالضبط؛ صار يُباع بالقطعة من 2
  select id into strict v_id from public.products where store='rifai' and is_active and name = 'عطر Exotic_for man';
  update public.products set sold_by = 'piece', price_unit = 'piece', wholesale_min = 2 where id = v_id;

  if exists (select 1 from public.product_prices pr join public.products p on p.id = pr.product_id
              where pr.price_wholesale <> round(pr.price_dozen / p.pack_qty::numeric)) then
    raise exception 'سعر قطعة لا يطابق ثمن علبته';
  end if;
end $$;
