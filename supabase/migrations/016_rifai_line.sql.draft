-- =====================================================================
-- 016 — سعر البند في دالة واحدة  (مسودة — لم تُطبَّق)
-- =====================================================================
-- حساب بند الطلب (مفرد، جملة، علبة، كمية جملة، عرض) كان داخل create_order.
-- يُنقل كما هو إلى rifai_line ليستعمله create_order ومتاجر المروّجين معاً،
-- فأساس المروّج = ما يحاسِب به متجر الرفاعي حرفياً، ولا نسختان تفترقان.
-- نتيجة create_order لا تتغيّر (اختبار تفاضلي: القديمة مقابل الجديدة).
-- =====================================================================
set local lock_timeout = '5s';

-- الترحيل مبنيّ على تعريف 014 بعينه. لو عدّله أحد بعده يتوقف بدل أن يمحوه.
do $$ begin
  if to_regprocedure('public.rifai_line(public.products,public.product_prices,text,int,boolean)') is null
     and md5(replace(pg_get_functiondef('public.create_order'::regproc), E'\r', '')) <> '122573f407d083f1aba9a0b1527e71c9' then
    raise exception 'create_order تغيّرت بعد 014 — راجع 016 قبل تطبيقه';
  end if;
end $$;

-- unit_price  سعر القطعة (بعد كمية الجملة إن بُلغت)
-- pack_price  ثمن العلبة إن كان البند يُباع بالعلبة، وإلا null؛ وpack_qty معه
-- min_qty     أقل كمية جملة للقطعة
-- total       ثمن البند، أو null إن كانت الكمية لا تصلح (ليست علباً كاملة)
create or replace function public.rifai_line(
  p public.products, pr public.product_prices, p_mode text, p_qty int, p_promo boolean,
  out unit_price bigint, out pack_price bigint, out pack_qty int, out min_qty int, out total bigint
) language plpgsql immutable set search_path = public as $$
begin
  min_qty    := case when p.sold_by = 'piece' then p.wholesale_min else 1 end;
  unit_price := public.rifai_price(pr.price_wholesale, pr.price_retail, p_mode, p_promo);
  -- بالعلبة: ثمنها كما أُدخل × عدد العلب، بلا قسمة
  if p.pack_only or (p_mode = 'wholesale' and p.sold_by <> 'piece') then
    pack_price := pr.price_dozen;
    pack_qty   := p.pack_qty;
    total      := case when p_qty % p.pack_qty = 0 then pr.price_dozen * (p_qty / p.pack_qty) end;
  else
    -- بلغ كمية الجملة في وضع المفرد ← سعر الجملة للقطعة
    if min_qty > 1 and p_qty >= min_qty and pr.price_wholesale > 0 then unit_price := pr.price_wholesale; end if;
    total := unit_price * p_qty;
  end if;
end $$;
revoke all on function public.rifai_line(public.products, public.product_prices, text, int, boolean) from public, anon, authenticated;

create or replace function public.create_order(p_customer_name text, p_customer_phone text, p_items jsonb, p_mode text default 'retail'::text, p_zone_id integer default null::integer, p_note text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  v_dozen bigint;
  v_pack int;
  v_min int;
  v_total bigint;
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
    select l.unit_price, p.name, p.code, p.barcode, p.quantity_single,
           l.pack_price, l.pack_qty, l.min_qty, l.total
      into v_price, v_name, v_code, v_bar, v_stock, v_dozen, v_pack, v_min, v_total
      from public.products p
      join public.product_prices pr on pr.product_id = p.id
      cross join lateral public.rifai_line(p, pr, p_mode, v_qty,
             (select s.value = 'on' from public.app_settings s where s.key = 'promo_wholesale_all')) l
     where p.id = v_id and p.is_active = true and p.store = 'rifai';

    if v_price is null then
      raise exception 'أحد المنتجات لم يعد متوفراً في المتجر';
    end if;
    if v_stock < v_qty then
      raise exception 'الكمية المطلوبة من «%» غير متوفرة (المتوفر: % قطعة)', v_name, v_stock;
    end if;

    if v_dozen is not null then
      if v_qty % v_pack <> 0 then
        raise exception '«%» تُباع بالعلبة كاملة (% قطعة)', v_name, v_pack;
      end if;
    elsif p_mode = 'wholesale' and v_qty < v_min then
      raise exception 'أقل كمية جملة من «%» هي % قطع', v_name, v_min;
    end if;

    if v_total = 0 then v_ask := true; end if;

    v_sub := v_sub + v_total;
    v_lines := v_lines || jsonb_build_object(
      'product_id',       v_id,
      'code',             v_code,   -- رمز صفحة المنتج: يميّز المتشابهات
      'barcode',          v_bar,    -- ما هو مطبوع على العلبة في الرفّ
      'name',             v_name,
      'qty',              v_qty,
      'unit_price',       v_price,
      'line_total',       v_total,
      'dozen_price',      v_dozen,
      'pack_qty',         v_pack,
      'price_on_request', (v_total = 0));
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
end $function$;
