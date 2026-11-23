-- السعر كما كتبه مدخل البيانات: لا قسمة على 12 ولا كسور.
-- كان سعر الدرزن يُخزَّن round(مُدخَل/12) فتصير 28000 ← 2333 ← تُعرض 27996.
-- الآن price_dozen = ثمن الدرزن كما أُدخل، وهو ما يُعرض ويُحاسَب في الجملة.
-- price_wholesale (للقطعة) يبقى مشتقاً منه لأن متجر المنى يحسب عليه.

-- 1) إيقاف عرض «المفرد بسعر الجملة»: المفرد يعود كما أُدخل
update public.app_settings set value = 'off', updated_at = now() where key = 'promo_wholesale_all';

-- 2) العمود واسترجاع المُدخَل: الرقم الوحيد المدوَّر الذي يعطي نفس القسمة المخزّنة.
--    إن لم يوجد رقم مدوَّر يبقى 12 × المخزَّن.
alter table public.product_prices add column if not exists price_dozen bigint not null default 0 check (price_dozen >= 0);

update public.product_prices pr set price_dozen = coalesce(
    case when p.price_unit = 'piece' or p.store <> 'rifai' then null else (
      select e from (values (1000), (500), (250)) s(step),
             lateral (select (round(pr.price_wholesale * 12.0 / step) * step)::bigint e) x
       where round(x.e / 12.0) = pr.price_wholesale
       order by step desc limit 1) end,
    pr.price_wholesale * 12)
  from public.products p
 where p.id = pr.product_id and pr.price_wholesale > 0;

do $$ begin
  if exists (select 1 from public.product_prices where price_wholesale <> round(price_dozen / 12.0)) then
    raise exception 'الاسترجاع غيّر سعر قطعة';
  end if;
end $$;

-- 3) المصدر هو price_dozen. كاتبٌ قديم يرسل price_wholesale وحده ← يُشتقّ الدرزن منه.
create or replace function public.sync_price_dozen() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.price_dozen > 0 then new.price_wholesale := round(new.price_dozen / 12.0);
    else new.price_dozen := new.price_wholesale * 12; end if;
  elsif new.price_dozen is distinct from old.price_dozen then
    new.price_wholesale := round(new.price_dozen / 12.0);
  elsif new.price_wholesale is distinct from old.price_wholesale then
    new.price_dozen := new.price_wholesale * 12;
  end if;
  return new;
end $$;
drop trigger if exists trg_sync_price_dozen on public.product_prices;
create trigger trg_sync_price_dozen before insert or update on public.product_prices
  for each row execute function public.sync_price_dozen();

-- 4) العرض العام والطلب
do $$
declare d text; n text;
  procedure_missing constant text := 'لم ينطبق التعديل على ';
begin
  d := regexp_replace(pg_get_viewdef('public.storefront_products'::regclass, true), ';\s*$', '');
  if d not like '%price_dozen%' then
    n := replace(d, E'p.description\n', E'p.description,\n    pr.price_dozen\n');
    if n = d then raise exception '%', procedure_missing || 'storefront_products'; end if;
    execute 'create or replace view public.storefront_products as ' || n;
  end if;

  d := pg_get_functiondef('public.create_order'::regproc);
  n := replace(d, E'  v_stock int;\n', E'  v_stock int;\n  v_dozen bigint;\n  v_total bigint;\n');
  if n = d then raise exception '%', procedure_missing || 'create_order 1'; end if; d := n;
  n := regexp_replace(d, 'p\.barcode, p\.quantity_single\s+into v_price, v_name, v_code, v_bar, v_stock',
    $r$p.barcode, p.quantity_single,
           case when p_mode = 'wholesale' and p.sold_by <> 'piece' then pr.price_dozen end
      into v_price, v_name, v_code, v_bar, v_stock, v_dozen$r$);
  if n = d then raise exception '%', procedure_missing || 'create_order 2'; end if; d := n;
  n := replace(d, 'if v_price = 0 then v_ask := true; end if;',
    $r$-- الجملة بالدرزن: ثمن الدرزن كما أُدخل × عدد الدرازن، بلا قسمة
    if v_dozen is not null then
      if v_qty % 12 <> 0 then
        raise exception '«%» تُباع جملةً بالدرزن (12 قطعة)', v_name;
      end if;
      v_total := v_dozen * (v_qty / 12);
    else
      v_total := v_price * v_qty;
    end if;

    if v_total = 0 then v_ask := true; end if;$r$);
  if n = d then raise exception '%', procedure_missing || 'create_order 3'; end if; d := n;
  n := replace(d, 'v_sub := v_sub + v_price * v_qty;', 'v_sub := v_sub + v_total;');
  if n = d then raise exception '%', procedure_missing || 'create_order 4'; end if; d := n;
  n := regexp_replace(d, '''line_total'',(\s+)v_price \* v_qty', '''line_total'',\1v_total');
  if n = d then raise exception '%', procedure_missing || 'create_order 5'; end if; d := n;
  n := replace(d, '''price_on_request'', (v_price = 0))', '''dozen_price'',      v_dozen,
      ''price_on_request'', (v_total = 0))');
  if n = d then raise exception '%', procedure_missing || 'create_order 6'; end if;
  execute n;
end $$;
