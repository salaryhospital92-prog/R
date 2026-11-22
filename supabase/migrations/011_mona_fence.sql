-- =====================================================================
-- 011 — سياج الرفاعي: فصل بيانات المنى عن واجهة الرفاعي وتقاريره
-- =====================================================================
-- هذه كائنات يملكها supabase/operations.sql. إعادة تشغيله تمحو السياج
-- وتُعيدها إلى نسختها العامة — وهذا ما حدث فعلاً مرة. إن أُعيد تشغيل
-- operations.sql يوماً فاحذف سطر هذا الملف من public.schema_migrations
-- ثم شغّل npm run db ليُعاد السياج:
--
--   delete from public.schema_migrations where name = '011_mona_fence.sql';
--
-- الدوال هنا منسوخة من تعريفها الحيّ وقت كتابة الملف (بكل ما أضافه
-- 001–008: أزرار زاد، إجازة الجمعة، أوقات العمل، وصف المنتج)، ولم
-- يُغيَّر فيها إلا شرط الفصل. فلا يضيع عمل سابق.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) العروض العامة — تُعدَّل بقراءة تعريفها الحالي لا بإعادة كتابته،
--    فأي عمود يُضاف لها لاحقاً (مثل description) لا يضيع.
-- ---------------------------------------------------------------------
do $$
declare d text;
begin
  d := pg_get_viewdef('public.storefront_products'::regclass, true);
  d := regexp_replace(d, ';\s*$', '');
  if d like '%p.store%' then return; end if;
  if d not like '%p.is_active = true%' then
    raise exception 'شكل storefront_products غير متوقّع — السياج لم يُطبَّق';
  end if;
  d := replace(d, 'p.is_active = true', 'p.is_active = true AND p.store = ''rifai''');
  execute 'create or replace view public.storefront_products as ' || d;
end $$;

do $$
declare d text;
begin
  d := pg_get_viewdef('public.popular_products'::regclass, true);
  d := regexp_replace(d, ';\s*$', '');
  if d like '%mona%' then return; end if;
  if d not like '%o.status <> ''cancelled''%' then
    raise exception 'شكل popular_products غير متوقّع — السياج لم يُطبَّق';
  end if;
  d := replace(d, 'o.status <> ''cancelled''::order_status',
                  'o.source <> ''mona'' AND o.status <> ''cancelled''::order_status');
  execute 'create or replace view public.popular_products as ' || d;
end $$;


-- ---------------------------------------------------------------------
-- 2) الدوال — نسخة حيّة + شرط الفصل وحده
--
--    create_order    منتج منى لا يُطلب من متجر الرفاعي حتى لو عُرف معرّفه.
--                    (بلا هذا السطر ينسخ أحد معرّف منتج من متجر المنى
--                     ويرسله إلى create_order فيصير طلباً رفاعياً.)
--    finance_summary مبيعات المنى خارج حسابات الرفاعي: الطلب يحمل سعر
--                    المنى لا سعر جملة الرفاعي، فضمّه يضخّم الإيراد.
--    top_products    الأكثر مبيعاً عند الرفاعي وحده.
--    low_stock       تنبيه نفاد مخزون الرفاعي وحده.
--    notify_new_order روابط المنتجات في إشعار طلب المنى تفتح موقع المنى،
--                    والعنوان يميّزه. قناة الإرسال تبقى واحدة.
-- ---------------------------------------------------------------------

-- ====== create_order ======
CREATE OR REPLACE FUNCTION public.create_order(p_customer_name text, p_customer_phone text, p_items jsonb, p_mode text DEFAULT 'retail'::text, p_zone_id integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     where p.id = v_id and p.is_active = true and p.store = 'rifai';

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
end $function$;


-- ====== notify_new_order ======
CREATE OR REPLACE FUNCTION public.notify_new_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_token text; v_site text; v_text text; v_kb jsonb; v_zad boolean;
  v_chat text; v_line jsonb; v_items text := ''; v_qty text; v_i int := 0; v_site2 text;
begin
  select value into v_token from public.app_settings where key = 'telegram_bot_token';
  select value into v_site  from public.app_settings where key = 'store_url';
  -- طلب المنى: روابط منتجاته تفتح موقع المنى لا موقع الرفاعي
  if new.source = 'mona' then
    select nullif(trim(value), '') into v_site2 from public.app_settings where key = 'mona_store_url';
    v_site := coalesce(v_site2, v_site);
  end if;
  select value in ('on', 'link') into v_zad from public.app_settings where key = 'bot_zad_buttons';
  if coalesce(v_token, '') = '' then return new; end if;

  for v_line in select * from jsonb_array_elements(new.items_json) loop
    v_i := v_i + 1;
    v_qty := case when new.mode = 'wholesale' and (v_line->>'qty')::int % 12 = 0
                  then to_char((v_line->>'qty')::int / 12, 'FM999,999') || ' درزن'
                  else to_char((v_line->>'qty')::int, 'FM999,999') || ' قطعة' end;

    v_items := v_items || v_i || '. ' || (v_line->>'name') || ' — ' || v_qty ||
      case when (v_line->>'price_on_request')::boolean then ' — السعر عند الطلب'
           else ' = ' || to_char((v_line->>'line_total')::bigint, 'FM999,999,999') || ' د.ع' end
      || E'\n';

    if (v_line->>'code') is not null then
      v_items := v_items || '   🔗 ' || coalesce(v_site, '') || '/p/' || (v_line->>'code');
      if (v_line->>'barcode') is not null then
        v_items := v_items || '  ·  ' || (v_line->>'barcode');
      end if;
      v_items := v_items || E'\n';
    end if;
  end loop;

  v_text :=
    case when extract(dow from now() at time zone 'Asia/Baghdad') = 5
              then '⏰ إجازة الجمعة — يُجهَّز يوم السبت الساعة 9:00 صباحاً' || E'\n'
         when (now() at time zone 'Asia/Baghdad')::time between time '09:00' and time '17:45:59' then ''
         else '⏰ خارج أوقات العمل — يُجهَّز ' ||
              case when (now() at time zone 'Asia/Baghdad')::time < time '09:00' then 'اليوم'
              when extract(dow from now() at time zone 'Asia/Baghdad') = 4 then 'يوم السبت'
              else 'غداً' end ||
              E' الساعة 9:00 صباحاً\n' end
    || case when new.source = 'mona' then '🌸 طلب المنى #' else '🛒 طلب جديد #' end || new.order_number || E'\n' ||
    'النوع: ' || case when new.mode = 'wholesale' then 'جملة' else 'مفرد' end || E'\n' ||
    'الزبون: ' || new.customer_name || E'\n' ||
    'الهاتف: ' || new.customer_phone || E'\n' ||
    'المنطقة: ' || coalesce(new.delivery_zone, '—') || E'\n' ||
    coalesce('ملاحظة: ' || new.customer_note || E'\n', '') || E'\n' ||
    v_items || E'\n' ||
    'البضاعة: ' || to_char(new.subtotal, 'FM999,999,999') || ' د.ع' || E'\n' ||
    'التوصيل: ' || to_char(new.delivery_fee, 'FM999,999,999') || ' د.ع' || E'\n' ||
    '💰 المجموع: ' || to_char(new.total_amount, 'FM999,999,999') || ' د.ع';

  v_kb := jsonb_build_array(jsonb_build_array(
            jsonb_build_object('text', '📦 فتح الطلب', 'callback_data', 'ord:' || new.id)));
  if coalesce(v_zad, false) then
    v_kb := jsonb_build_array(
      jsonb_build_array(case when (select value from public.app_settings where key = 'bot_zad_buttons') = 'link'
         then jsonb_build_object('text', '🚴 استدعاء كابتن', 'url', coalesce(v_site, '') || '/dashboard/dispatch')
         else jsonb_build_object('text', '🚴 تأكيد واستدعاء كابتن', 'callback_data', 'zad:' || new.id) end),
      v_kb->0);
  end if;

  -- كل مدير فعّال في البوت؛ وإن لم يوجد أحد فالمحادثة المسجَّلة قديماً
  for v_chat in
    select telegram_id::text from public.telegram_agents where is_active and role = 'admin'
    union
    select value from public.app_settings where key = 'telegram_chat_id' and nullif(value, '') is not null
  loop
    perform net.http_post(
      url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object('chat_id', v_chat, 'disable_web_page_preview', true,
                                    'text', v_text, 'reply_markup', jsonb_build_object('inline_keyboard', v_kb)));
  end loop;
  return new;
exception when others then
  return new;
end $function$;


-- ====== finance_summary ======
CREATE OR REPLACE FUNCTION public.finance_summary(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'orders_count',   (select count(*) from public.orders
                        where source <> 'mona' and status <> 'cancelled' and created_at::date between p_from and p_to),
    'sales_goods',    (select coalesce(sum(subtotal), 0) from public.orders
                        where source <> 'mona' and status <> 'cancelled' and created_at::date between p_from and p_to),
    'sales_delivery', (select coalesce(sum(delivery_fee), 0) from public.orders
                        where source <> 'mona' and status <> 'cancelled' and created_at::date between p_from and p_to),
    'sales_total',    (select coalesce(sum(total_amount), 0) from public.orders
                        where source <> 'mona' and status <> 'cancelled' and created_at::date between p_from and p_to),
    'sales_cash',     (select coalesce(sum(total_amount), 0) from public.orders
                        where source <> 'mona' and status <> 'cancelled' and payment = 'cash'
                          and created_at::date between p_from and p_to),
    'sales_debt',     (select coalesce(sum(total_amount), 0) from public.orders
                        where source <> 'mona' and status <> 'cancelled' and payment = 'debt'
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
$function$;


-- ====== top_products ======
CREATE OR REPLACE FUNCTION public.top_products(p_from date, p_to date, p_limit integer DEFAULT 10)
 RETURNS TABLE(name text, qty bigint, revenue bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select it->>'name' as name,
         sum((it->>'qty')::int)::bigint as qty,
         sum((it->>'line_total')::bigint)::bigint as revenue
    from public.orders o, jsonb_array_elements(o.items_json) it
   where o.source <> 'mona' and o.status <> 'cancelled' and o.created_at::date between p_from and p_to
   group by 1 order by 2 desc limit p_limit;
$function$;


-- ====== low_stock ======
CREATE OR REPLACE FUNCTION public.low_stock(p_threshold integer DEFAULT 12)
 RETURNS TABLE(id uuid, name text, category text, quantity_single integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id, p.name, c.name, p.quantity_single
    from public.products p
    left join public.categories c on c.id = p.category_id
   where p.is_active and p.store = 'rifai' and p.quantity_single <= p_threshold
   order by p.quantity_single, p.name;
$function$;


