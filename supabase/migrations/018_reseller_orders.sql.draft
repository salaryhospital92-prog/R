-- =====================================================================
-- 018 — متاجر المروّجين: التسعير والعرض والطلب وإدارة المتجر (مسودة)
-- =====================================================================

-- إشعار المديرين: فشله لا يُفشل شيئاً
create or replace function public.reseller_notify_admins(p_text text, p_buttons jsonb default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text; v_chat text;
begin
  select value into v_token from public.app_settings where key = 'telegram_bot_token';
  if coalesce(v_token, '') = '' then return; end if;
  for v_chat in
    select telegram_id::text from public.telegram_agents where is_active and role = 'admin'
    union
    select value from public.app_settings where key = 'telegram_chat_id' and nullif(value, '') is not null
  loop
    perform net.http_post(
      url     := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_strip_nulls(jsonb_build_object('chat_id', v_chat, 'text', p_text,
                   'reply_markup', case when p_buttons is not null then jsonb_build_object('inline_keyboard', p_buttons) end)));
  end loop;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------
-- 1) السعر — موضع واحد للعرض واللوحة والطلب
--    السعر الثابت ثم الزيادة، تقريب لأعلى، سقف، ولا أقل من الأساس أبداً.
--    أساس 0 أو فارغ = لا سعر = لا يظهر ولا يُطلب.
-- ---------------------------------------------------------------------
create or replace function public.reseller_price(
  p_base bigint, p_override bigint, p_type text, p_value bigint, p_round int, p_cap numeric
) returns bigint language sql immutable set search_path = public as $$
  select case when coalesce(p_base, 0) > 0 then greatest(p_base, least(
    coalesce(p_override,
      (ceil((case when p_type = 'percent' then p_base * (100 + p_value) / 100.0 else p_base + p_value end)
            / greatest(p_round, 1)) * greatest(p_round, 1))::bigint),
    case when p_cap is not null then floor(p_base * (100 + p_cap) / 100)::bigint end)) end
$$;

-- كل أصناف المتجر الظاهرة بسعرها. p_qty يحسب البند؛ بدونه سعر الوحدة فقط.
-- step: 1 قطعة، أو قطع العلبة لما يُباع علباً. unit_* للوحدة المباعة (قطعة/علبة).
-- base_total = ما يحاسِب به متجر الرفاعي نفس البند (rifai_line)، وsell_total لا يقل عنه.
create or replace function public.reseller_lines(p_store uuid, p_product uuid default null, p_qty int default null)
returns table (product_id uuid, rifai_name text, code text, barcode text, stock int, name text, description text,
               category_id int, category text, image_url text, pack_qty int, step int, min_qty int,
               unit_base bigint, unit_price bigint, has_override boolean, is_visible boolean,
               base_total bigint, sell_total bigint)
language sql stable security definer set search_path = public as $$
  with s as (
    select st.*, coalesce(public.reseller_cfg('reseller_base'), 'retail') as base_mode,
           public.reseller_num('reseller_max_markup_percent', null) as cap,
           coalesce((select a.value = 'on' from public.app_settings a where a.key = 'promo_wholesale_all'), false) as promo
      from public.reseller_stores st where st.id = p_store
  ), x as (
    select p.id, p.name as rifai_name, p.code, p.barcode, p.quantity_single,
           coalesce(nullif(trim(rp.display_name), ''), p.name) as name, rp.display_description,
           p.category_id, c.name as category, p.image_url, u.pack_qty,
           coalesce(u.pack_qty, 1) as step,
           coalesce(u.pack_qty, case when s.base_mode = 'wholesale' then u.min_qty else 1 end) as min_qty,
           coalesce(u.pack_price, u.unit_price) as unit_base,
           public.reseller_price(coalesce(u.pack_price, u.unit_price), rp.price_override,
             s.markup_type, s.markup_value, s.round_to, s.cap) as unit_price,
           rp.price_override is not null as has_override, coalesce(rp.is_visible, true) as is_visible,
           l.total
      from s
      join public.reseller_categories rc on rc.store_id = s.id
      join public.categories c on c.id = rc.category_id
      join public.products p on p.category_id = c.id and p.is_active and p.store = 'rifai' and not p.reseller_hidden
      join public.product_prices pr on pr.product_id = p.id
      left join public.reseller_products rp on rp.store_id = s.id and rp.product_id = p.id
      cross join lateral public.rifai_line(p, pr, case s.base_mode when 'wholesale' then 'wholesale' else 'retail' end, 1, s.promo) u
      cross join lateral public.rifai_line(p, pr, case s.base_mode when 'wholesale' then 'wholesale' else 'retail' end, p_qty, s.promo) l
     where p_product is null or p.id = p_product
  )
  select id, rifai_name, code, barcode, quantity_single, name, display_description, category_id, category, image_url,
         pack_qty, step, min_qty, unit_base, unit_price, has_override, is_visible, total,
         case when total > 0 then greatest(total, unit_price * (p_qty / step)) end
    from x where unit_price is not null
$$;

-- ---------------------------------------------------------------------
-- 2) الزبون (anon): متجر فعّال فقط، وسعر البيع فقط
-- ---------------------------------------------------------------------
create or replace function public.reseller_store(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', slug, 'name', name, 'logo_path', logo_path, 'theme_color', theme_color,
                            'about', about, 'whatsapp', whatsapp,
                            'open', coalesce(public.reseller_cfg('reseller_orders_enabled') = 'on', false),
                            -- مناطق زاد فقط (كما يشترطها reseller_create_order): «الاستلام من المحل» يكشف الرفاعي
                            'zones', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name, 'fee', z.fee)
                                                              order by z.sort_order, z.id)
                                                 from public.delivery_zones z where z.is_active and z.zad_zone_id is not null), '[]'::jsonb))
    from public.reseller_stores where slug = lower(p_slug) and status = 'active'
$$;

create or replace function public.reseller_store_products(p_slug text)
returns table (id uuid, name text, description text, category_id int, category text, image_url text,
               price bigint, pack_qty int, min_qty int, max_qty int)
language sql stable security definer set search_path = public as $$
  -- max_qty بسقف 50: يكفي السلة ولا يكشف مخزون الرفاعي
  select l.product_id, l.name, l.description, l.category_id, l.category, l.image_url, l.unit_price, l.pack_qty, l.min_qty,
         case when l.stock < l.min_qty then 0 else least(l.stock / l.step, 50) * l.step end
    from public.reseller_stores s cross join lateral public.reseller_lines(s.id) l
   where s.slug = lower(p_slug) and s.status = 'active' and l.is_visible
$$;

create or replace function public.reseller_create_order(
  p_slug text, p_customer_name text, p_customer_phone text, p_items jsonb,
  p_zone_id int, p_note text default null, p_expected_total bigint default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_store public.reseller_stores; v_zone public.delivery_zones; v_phone text; v_mode text;
  v_cart jsonb; v_ok boolean; r record; l record; v_lines jsonb := '[]'; v_own jsonb := '[]';
  v_base bigint := 0; v_sell bigint := 0; v_order public.orders; n int := 0;
begin
  if public.reseller_cfg('reseller_orders_enabled') is distinct from 'on' then
    raise exception 'الطلب متوقف مؤقتاً';
  end if;
  select * into v_store from public.reseller_stores where slug = lower(p_slug) and status = 'active';
  if not found then raise exception 'المتجر غير متاح'; end if;

  if length(trim(coalesce(p_customer_name, ''))) not between 2 and 120 then raise exception 'الرجاء إدخال اسم الزبون'; end if;
  v_phone := public.zad_canonical_phone(p_customer_phone);
  if v_phone is null then raise exception 'الرجاء إدخال رقم هاتف صحيح'; end if;
  if length(p_note) > 500 then raise exception 'الملاحظة طويلة'; end if;
  -- مناطق التوصيل فقط: «استلام من المحل» يكشف الرفاعي
  select * into v_zone from public.delivery_zones where id = p_zone_id and is_active and zad_zone_id is not null;
  if not found then raise exception 'منطقة التوصيل غير متاحة'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'قائمة المنتجات غير صالحة';
  end if;
  begin
    -- تكرار المنتج يُجمع حتى تُحسب كمية الجملة والمخزون على المجموع
    select jsonb_agg(jsonb_build_object('id', id, 'qty', q) order by id), bool_and(id is not null and ok and m > 0 and q <= 1000)
      into v_cart, v_ok
      from (select (i->>'product_id')::uuid id, sum((i->>'qty')::int) q, min((i->>'qty')::int) m, count(*) = count(i->>'qty') ok
              from jsonb_array_elements(p_items) i group by 1) t;
    if v_ok is not true then raise exception 'x'; end if;
  exception when others then raise exception 'كمية غير صالحة';
  end;

  -- حدّ المعدل. القفل يجعل العدّ صحيحاً لطلبين متزامنين من نفس الهاتف.
  perform pg_advisory_xact_lock(hashtext('reseller_order'), hashtext(v_phone));
  if (select count(*) from public.orders o where o.source = 'reseller' and o.created_at > now() - interval '1 hour'
       and public.zad_canonical_phone(o.customer_phone) = v_phone) >= 5 then
    raise exception 'طلبات كثيرة من هذا الرقم — حاول لاحقاً';
  end if;
  -- حد المتجر 30/ساعة يحميه من الإغراق، لكن لا يُعطِّله: الملغى لا يُعدّ (يفرّغه الموظف)،
  -- ومن سبق أن استلم من هذا المتجر يطلب دائماً (حدّ الهاتف 5/ساعة يبقى عليه)
  if (select count(*) from public.orders o where o.reseller_store_id = v_store.id and o.status <> 'cancelled'
       and o.created_at > now() - interval '1 hour') >= 30
     and not exists (select 1 from public.orders o where o.reseller_store_id = v_store.id and o.status = 'delivered'
       and public.zad_canonical_phone(o.customer_phone) = v_phone) then
    raise exception 'المتجر مشغول الآن — حاول لاحقاً';
  end if;

  -- قفل المنتجات بترتيب ثابت: لا سباق على المخزون ولا تشابك بين سلّتين
  perform 1 from public.products p where p.id in (select (c->>'id')::uuid from jsonb_array_elements(v_cart) c)
    order by p.id for update;

  for r in select (c->>'id')::uuid id, (c->>'qty')::int qty from jsonb_array_elements(v_cart) c loop
    select * into l from public.reseller_lines(v_store.id, r.id, r.qty) where is_visible;
    if not found then raise exception 'أحد المنتجات لم يعد متوفراً في المتجر'; end if;
    if r.qty % l.step <> 0 then raise exception '«%» تُباع بالعلبة كاملة (% قطعة)', l.name, l.step; end if;
    if r.qty < l.min_qty then raise exception 'أقل كمية من «%» هي % قطع', l.name, l.min_qty; end if;
    if l.stock < r.qty then raise exception 'الكمية المطلوبة من «%» غير متوفرة', l.name; end if;
    if coalesce(l.base_total, 0) <= 0 then raise exception 'أحد المنتجات لم يعد متوفراً في المتجر'; end if;

    n := n + 1;
    v_base := v_base + l.base_total;
    v_sell := v_sell + l.sell_total;
    -- items_json للتجهيز: الاسم الحقيقي والرمز، وسعر المروّج. لا أساس فيه.
    v_lines := v_lines || jsonb_build_object('product_id', r.id, 'code', l.code, 'barcode', l.barcode, 'name', l.rifai_name,
      'qty', r.qty, 'unit_price', l.unit_price, 'line_total', l.sell_total,
      'dozen_price', case when l.pack_qty is not null then l.unit_price end, 'pack_qty', l.pack_qty, 'price_on_request', false);
    v_own := v_own || jsonb_build_object('line_no', n, 'product_id', r.id, 'display_name', l.name, 'qty', r.qty,
      'pack_qty', l.pack_qty, 'unit_price', l.unit_price, 'base_total', l.base_total, 'sell_total', l.sell_total);
  end loop;

  if p_expected_total is not null and p_expected_total <> v_sell + v_zone.fee then
    raise exception 'تغيّر السعر — راجع السلة';
  end if;

  insert into public.orders (customer_name, customer_phone, mode, subtotal, delivery_zone, delivery_fee,
                             customer_note, total_amount, items_json, source, reseller_store_id)
  values (trim(p_customer_name), trim(p_customer_phone), 'retail', v_sell, v_zone.name, v_zone.fee,
          nullif(trim(coalesce(p_note, '')), ''), v_sell + v_zone.fee, v_lines, 'reseller', v_store.id)
  returning * into v_order;

  v_mode := coalesce(public.reseller_cfg('reseller_base'), 'retail');
  insert into public.reseller_orders (order_id, store_id, base_subtotal, reseller_subtotal, base_mode)
  values (v_order.id, v_store.id, v_base, v_sell, v_mode);
  insert into public.reseller_order_items (order_id, line_no, product_id, display_name, qty, pack_qty, unit_price, base_total, sell_total)
  select v_order.id, i.* from jsonb_to_recordset(v_own) as
    i(line_no int, product_id uuid, display_name text, qty int, pack_qty int, unit_price bigint, base_total bigint, sell_total bigint);

  -- created_by فارغ صراحةً: زائر مسجَّل الدخول قد لا يملك صفّ profiles
  insert into public.stock_movements (product_id, type, singles_qty, source, order_id, note, created_by)
  select (i->>'product_id')::uuid, 'sale', -(i->>'qty')::int, 'order', v_order.id, 'طلب متجر ' || v_store.slug || ' #' || v_order.order_number, null
    from jsonb_array_elements(v_lines) i;

  return jsonb_build_object('order_number', v_order.order_number, 'subtotal', v_sell, 'delivery_zone', v_zone.name,
    'delivery_fee', v_zone.fee, 'total_amount', v_order.total_amount,
    'items', (select jsonb_agg(jsonb_build_object('name', i->>'display_name', 'qty', (i->>'qty')::int, 'pack_qty', (i->>'pack_qty')::int,
                'unit_price', (i->>'unit_price')::bigint, 'line_total', (i->>'sell_total')::bigint)) from jsonb_array_elements(v_own) i));
end $$;

-- مبالغ طلب المروّج ثابتة: لا تسعير بند ولا خصم ولا نقل بين المصادر
create or replace function public.reseller_order_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.source, new.reseller_store_id, new.items_json, new.subtotal, new.discount, new.payment, new.mode)
     is distinct from (old.source, old.reseller_store_id, old.items_json, old.subtotal, old.discount, old.payment, old.mode)
     or new.total_amount <> new.subtotal + new.delivery_fee then
    raise exception 'مبالغ طلب المروّج لا تُعدَّل — ألغِ الطلب واطلب من جديد';
  end if;
  return new;
end $$;
create trigger trg_reseller_order_guard before update on public.orders
  for each row when (old.source = 'reseller' or new.source = 'reseller')
  execute function public.reseller_order_guard();

-- ---------------------------------------------------------------------
-- 3) المروّج
-- ---------------------------------------------------------------------
create or replace function public.reseller_save_store(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.reseller_stores; n public.reseller_stores; v_phone text; v_wa text;
begin
  if auth.uid() is null or coalesce(auth.role(), '') <> 'authenticated' then raise exception 'سجّل الدخول أولاً'; end if;
  select * into s from public.reseller_stores where owner_id = auth.uid() for no key update;
  if s.status = 'suspended' then raise exception 'متجرك موقوف — راجع الإدارة'; end if;

  v_phone := case when p ? 'phone' then public.zad_canonical_phone(p->>'phone') else s.phone end;
  if v_phone is null then raise exception 'رقم هاتفك غير صحيح'; end if;
  v_wa := case when p ? 'whatsapp' then public.zad_canonical_phone(p->>'whatsapp') else s.whatsapp end;
  if nullif(p->>'whatsapp', '') is not null and v_wa is null then raise exception 'رقم واتساب غير صحيح'; end if;

  n := s;
  n.slug         := case when p ? 'slug' then lower(trim(p->>'slug')) else s.slug end;
  n.name         := case when p ? 'name' then trim(p->>'name') else s.name end;
  n.logo_path    := case when p ? 'logo_path' then nullif(p->>'logo_path', '') else s.logo_path end;
  n.theme_color  := coalesce(lower(p->>'theme_color'), s.theme_color, '#059669');
  n.about        := case when p ? 'about' then nullif(trim(p->>'about'), '') else s.about end;
  n.markup_type  := coalesce(p->>'markup_type', s.markup_type, 'percent');
  n.markup_value := coalesce((p->>'markup_value')::bigint, s.markup_value, 0);
  n.round_to     := coalesce((p->>'round_to')::int, s.round_to, 250);

  if n.logo_path is not null and n.logo_path !~ ('^' || auth.uid() || '/[A-Za-z0-9._-]{1,80}\.(png|jpe?g|webp)$') then
    raise exception 'مسار الشعار غير صالح';
  end if;
  if public.reseller_slug_ok(n.slug) is not true then raise exception 'الرابط غير صالح أو محجوز'; end if;

  if s.id is null then
    insert into public.reseller_stores (owner_id, slug, name, logo_path, theme_color, phone, whatsapp, about, markup_type, markup_value, round_to)
    values (auth.uid(), n.slug, n.name, n.logo_path, n.theme_color, v_phone, v_wa, n.about, n.markup_type, n.markup_value, n.round_to)
    returning id into n.id;
    return n.id;
  end if;

  -- ما راجعه المدير لا يتبدّل تحته، والرابط لا ينكسر بعد التفعيل
  if s.status = 'pending' and (n.slug, n.name, n.logo_path) is distinct from (s.slug, s.name, s.logo_path) then
    raise exception 'طلبك قيد المراجعة — لا يتغيّر الاسم أو الرابط أو الشعار الآن';
  end if;
  if s.status = 'active' and n.slug <> s.slug then raise exception 'الرابط لا يتغيّر بعد التفعيل'; end if;

  update public.reseller_stores set slug = n.slug, name = n.name, logo_path = n.logo_path, theme_color = n.theme_color,
    phone = v_phone, whatsapp = v_wa, about = n.about, markup_type = n.markup_type, markup_value = n.markup_value, round_to = n.round_to
   where id = s.id;

  if s.status = 'active' and (n.name, n.logo_path) is distinct from (s.name, s.logo_path) then
    insert into public.reseller_audit (store_id, actor, action, detail)
    values (s.id, 'owner:' || auth.uid(), 'identity_changed', s.name || ' ← ' || n.name);
    perform public.reseller_notify_admins('✏️ متجر مروّج غيّر هويته' || E'\nالاسم قبل: ' || s.name || E'\nالاسم الآن: ' || n.name
      || case when n.logo_path is distinct from s.logo_path then E'\nوتغيّر الشعار' else '' end);
  end if;
  return s.id;
exception when unique_violation then raise exception 'الرابط مستعمل — اختر غيره';
end $$;

create or replace function public.reseller_submit_store() returns void
language plpgsql security definer set search_path = public as $$
declare s public.reseller_stores;
begin
  select * into s from public.reseller_stores where owner_id = auth.uid() for no key update;
  if not found then raise exception 'أنشئ متجرك أولاً'; end if;
  if s.status not in ('draft', 'rejected') then raise exception 'المتجر مُرسَل سابقاً'; end if;
  if not exists (select 1 from public.reseller_categories where store_id = s.id) then raise exception 'اختر صنفاً واحداً على الأقل'; end if;
  update public.reseller_stores set status = 'pending', status_reason = null where id = s.id;
  perform public.reseller_notify_admins('🏬 متجر مروّج جديد بانتظار التفعيل' || E'\nالاسم: ' || s.name || E'\nالرابط: ' ||
      coalesce(public.reseller_cfg('reseller_url') || '/', '') || s.slug ||
      case when s.logo_path is not null then E'\nالشعار: ' || s.logo_path else E'\nبلا شعار' end,
    jsonb_build_array(jsonb_build_array(
      jsonb_build_object('text', '✅ تفعيل', 'callback_data', 'rsok:' || s.id),
      jsonb_build_object('text', '✖️ رفض',  'callback_data', 'rsno:' || s.id))));
end $$;

-- أسعاري وأرباحي: لصاحب المتجر وحده
create or replace function public.reseller_catalog()
returns table (product_id uuid, rifai_name text, name text, category_id int, category text, image_url text, pack_qty int, min_qty int,
               base bigint, price bigint, profit bigint, has_override boolean, is_visible boolean, in_stock boolean)
language sql stable security definer set search_path = public as $$
  select l.product_id, l.rifai_name, l.name, l.category_id, l.category, l.image_url, l.pack_qty, l.min_qty, l.unit_base, l.unit_price,
         l.unit_price - l.unit_base, l.has_override, l.is_visible, l.stock >= l.min_qty
    from public.reseller_stores s cross join lateral public.reseller_lines(s.id) l
   where s.owner_id = auth.uid() and s.status <> 'suspended'
$$;

-- طلبات متجري. هاتف الزبون وملاحظته محجوبان إلا بإعداد المالك.
create or replace function public.reseller_my_orders(p_limit int default 50, p_before bigint default null)
returns table (order_id uuid, order_number bigint, status text, created_at timestamptz, customer_name text, customer_phone text,
               customer_note text, delivery_zone text, subtotal bigint, delivery_fee bigint, total_amount bigint,
               base_subtotal bigint, profit bigint, cancel_requested_at timestamptz, items jsonb)
language sql stable security definer set search_path = public as $$
  select o.id, o.order_number, o.status::text, o.created_at, o.customer_name,
         case when v.show then o.customer_phone end, case when v.show then o.customer_note end,
         o.delivery_zone, o.subtotal, o.delivery_fee, o.total_amount, ro.base_subtotal, ro.profit, ro.cancel_requested_at,
         (select jsonb_agg(jsonb_build_object('name', i.display_name, 'qty', i.qty, 'pack_qty', i.pack_qty,
                   'base', i.base_total, 'price', i.sell_total) order by i.line_no)
            from public.reseller_order_items i where i.order_id = o.id)
    from public.reseller_orders ro join public.orders o on o.id = ro.order_id
    cross join (select coalesce(public.reseller_cfg('reseller_show_customer_phone') = 'on', false) as show) v
   where ro.store_id = public.reseller_my_store() and (p_before is null or o.order_number < p_before)
   order by o.order_number desc limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

create or replace function public.reseller_request_cancel(p_order_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_no bigint;
begin
  update public.reseller_orders ro set cancel_requested_at = now(), cancel_reason = left(trim(p_reason), 300)
    from public.orders o
   where ro.order_id = p_order_id and o.id = ro.order_id and ro.store_id = public.reseller_my_store()
     and o.status in ('new', 'confirmed') and ro.cancel_requested_at is null
  returning o.order_number into v_no;
  if v_no is null then raise exception 'لا يمكن طلب إلغاء هذا الطلب'; end if;
  perform public.reseller_notify_admins('🛑 المروّج يطلب إلغاء الطلب #' || v_no || coalesce(E'\nالسبب: ' || nullif(left(trim(p_reason), 300), ''), ''));
end $$;

create or replace function public.reseller_telegram_code() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_store uuid := public.reseller_my_store(); v_code text := 'rs_' || encode(extensions.gen_random_bytes(12), 'hex');
begin
  if v_store is null then raise exception 'أنشئ متجرك أولاً'; end if;
  insert into public.reseller_telegram (store_id, code, code_expires_at) values (v_store, v_code, now() + interval '15 minutes')
  on conflict (store_id) do update set code = excluded.code, code_expires_at = excluded.code_expires_at;
  return v_code;
end $$;

-- للبوت وحده (service_role): يستهلك الرمز مرة واحدة
create or replace function public.reseller_telegram_link(p_code text, p_chat_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  update public.reseller_telegram t set chat_id = p_chat_id, code = null, code_expires_at = null, linked_at = now()
    from public.reseller_stores s
   where t.code = p_code and t.code_expires_at > now() and s.id = t.store_id
  returning s.name into v_name;
  return v_name;
exception when unique_violation then return null;     -- المحادثة مربوطة بمتجر آخر
end $$;

revoke all on function public.reseller_notify_admins(text, jsonb), public.reseller_price(bigint, bigint, text, bigint, int, numeric),
  public.reseller_lines(uuid, uuid, int), public.reseller_store(text), public.reseller_store_products(text),
  public.reseller_create_order(text, text, text, jsonb, int, text, bigint), public.reseller_order_guard(),
  public.reseller_save_store(jsonb), public.reseller_submit_store(), public.reseller_catalog(),
  public.reseller_my_orders(int, bigint), public.reseller_request_cancel(uuid, text),
  public.reseller_telegram_code(), public.reseller_telegram_link(text, bigint)
  from public, anon, authenticated;
grant execute on function public.reseller_store(text), public.reseller_store_products(text),
  public.reseller_create_order(text, text, text, jsonb, int, text, bigint) to anon, authenticated;
grant execute on function public.reseller_save_store(jsonb), public.reseller_submit_store(), public.reseller_catalog(),
  public.reseller_my_orders(int, bigint), public.reseller_request_cancel(uuid, text), public.reseller_telegram_code() to authenticated;
