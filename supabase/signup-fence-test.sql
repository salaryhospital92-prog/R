-- =====================================================================
-- فحص 013 — يُشغَّل محلياً فقط عبر: node scripts/check-signup-fence.mjs
-- لا تشغّله على القاعدة الحيّة: يُدرج في auth.users ويُنشئ طلباً.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- تسجيل كما تفعله خدمة Auth: إدراج غير مؤكَّد
create function pg_temp.signup(p_email text, p_meta jsonb default '{}',
                               p_at timestamptz default now()) returns uuid
language sql as $$
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          raw_user_meta_data, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', p_email, '', p_meta, p_at, p_at)
  returning id $$;

create function pg_temp.confirm(p_id uuid) returns void language sql as $$
  update auth.users set confirmation_token = '', email_confirmed_at = now() where id = p_id $$;

-- الصلاحيات كما يراها صاحب الجلسة: admin,staff,supervisor,mona,zad
create function pg_temp.rights(p_id uuid) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  r := concat_ws(',', case when public.is_admin() then 'admin' end,
                      case when public.is_staff() then 'staff' end,
                      case when public.is_supervisor() then 'supervisor' end,
                      case when public.is_mona_admin() then 'mona' end,
                      case when public.zad_can('storefront') then 'zad' end,
                      case when public.zad_can('mona') then 'zadmona' end);
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;

create function pg_temp.want(p_ok boolean, p_name text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'فشل: %', p_name; end if;
  raise notice '✔ %', p_name;
end $$;

do $$
declare u uuid; a uuid; v_prod uuid; v_zone int; n int; r text;
begin
  -- 1) الثغرة نفسها (هذا الفحص يفشل على القاعدة قبل 013)
  u := pg_temp.signup('stranger@example.test');
  perform pg_temp.want(pg_temp.rights(u) = '', '1أ المسجّل الجديد بلا أي صلاحية');
  perform pg_temp.confirm(u);
  perform pg_temp.want(pg_temp.rights(u) = '', '1ب وبعد تأكيد بريده أيضاً');
  perform pg_temp.want((select not is_active from public.profiles where id = u), '1ج صفّه موجود وموقوف');

  -- 2) بيانات يتحكم بها المسجّل لا تمنح شيئاً
  u := pg_temp.signup('meta@example.test', '{"role":"admin","is_active":true,"full_name":"x"}');
  perform pg_temp.confirm(u);
  perform pg_temp.want(pg_temp.rights(u) = '', '2 raw_user_meta_data لا ترفع الصلاحية');

  -- 3) بلا بريد (هاتف/مجهول) لا يسقط الزناد
  insert into auth.users (id, aud, role, created_at) values (gen_random_uuid(), 'authenticated', 'authenticated', now())
    returning id into u;
  perform pg_temp.want(pg_temp.rights(u) = '', '3 مستخدم بلا بريد لا يُسقط التسجيل ولا يُمنح');

  -- 4) الدور المعلّق: لا شيء قبل التأكيد، ويُمنح بعده، ويُستهلك
  for r in select unnest(array['admin', 'data_entry', 'mona_admin']) loop
    insert into public.pending_roles (email, role, full_name) values (r || '@example.test', r::public.user_role, 'موظف ' || r);
    u := pg_temp.signup(initcap(r) || '@Example.test');
    perform pg_temp.want(pg_temp.rights(u) = '', '4أ ' || r || ': غير مؤكَّد ⇒ بلا صلاحية');
    perform pg_temp.want(exists (select 1 from public.pending_roles where email = r || '@example.test'), '4ب ' || r || ': الدور لم يُستهلك');
    perform pg_temp.confirm(u);
    perform pg_temp.want(pg_temp.rights(u) = case r
        when 'admin' then 'admin,staff,supervisor,mona,zad,zadmona'
        when 'data_entry' then 'staff,supervisor,zad'
        else 'mona,zadmona' end, '4ج ' || r || ': مُنح بعد التأكيد');
    perform pg_temp.want(not exists (select 1 from public.pending_roles where email = r || '@example.test'), '4د ' || r || ': استُهلك');
  end loop;

  -- 5) حساب أُدرج مؤكَّداً من البداية (زناد الإدراج القائم)
  insert into public.pending_roles (email, role) values ('Upper@Example.test', 'data_entry');
  insert into auth.users (id, aud, role, email, email_confirmed_at, created_at)
    values (gen_random_uuid(), 'authenticated', 'authenticated', 'upper@example.test', now(), now()) returning id into u;
  perform pg_temp.want(pg_temp.rights(u) = 'staff,supervisor,zad', '5 مُدرَج مؤكَّداً ⇒ مُنح (وحالة الأحرف لا تهم)');

  -- 6) حُجز البريد قبل إضافة الدور ⇒ لا ترقية تلقائية
  u := pg_temp.signup('squat@example.test', '{}', now() - interval '1 day');
  insert into public.pending_roles (email, role) values ('squat@example.test', 'admin');
  perform pg_temp.confirm(u);
  perform pg_temp.want(pg_temp.rights(u) = '', '6 حساب أقدم من الدور المعلّق لا يُرقّى');

  -- 7) تغيير البريد إلى بريد معلّق لا يمنح
  insert into public.pending_roles (email, role) values ('boss@example.test', 'admin');
  u := pg_temp.signup('changer@example.test'); perform pg_temp.confirm(u);
  update auth.users set email = 'boss@example.test' where id = u;
  update auth.users set email_confirmed_at = now() where id = u;
  perform pg_temp.want(pg_temp.rights(u) = '', '7 تغيير البريد لا يستولي على دور معلّق');

  -- 8) موظف أُوقف لا يعود بإعادة التأكيد
  u := pg_temp.signup('fired@example.test'); perform pg_temp.confirm(u);
  update public.profiles set role = 'data_entry', is_active = false where id = u;
  update auth.users set email_confirmed_at = null where id = u;
  perform pg_temp.confirm(u);
  perform pg_temp.want(pg_temp.rights(u) = '', '8 الموقوف يبقى موقوفاً');

  -- 9) طريقة README: Add user + Auto Confirm ثم SQL
  u := pg_temp.signup('readme@example.test'); perform pg_temp.confirm(u);
  update public.profiles set role = 'admin' where id = u;
  perform pg_temp.want(pg_temp.rights(u) = '', '9أ السطر القديم (role وحده) لم يعد يكفي — متوقَّع');
  update public.profiles p set role = 'admin', is_active = true from auth.users x where x.id = p.id and x.email = 'readme@example.test';
  perform pg_temp.want(pg_temp.rights(u) like 'admin,%', '9ب السطر الجديد (role + is_active) يعمل');
  a := u;

  -- 10) الحسابات القائمة قبل 013 (زرعها المشغّل) لم تتغيّر
  select count(*) into n from public.profiles p join auth.users x on x.id = p.id
   where x.email like 'old-%@example.test' and p.is_active and 'old-' || p.role || '@example.test' = x.email;
  perform pg_temp.want(n = 3, '10 الحسابات القائمة (admin/data_entry/mona_admin) على حالها');

  -- 11) دعوات البوت: telegram_invites/telegram_agents لا تمرّ بـ auth ولا profiles
  select count(*) into n from public.profiles;
  set local role service_role;
  insert into public.telegram_invites (code, role) values ('TESTCODE', 'data_entry');
  insert into public.telegram_agents (telegram_id, agent_name, role, is_active) values (1, 'x', 'data_entry', true);
  update public.telegram_invites set used_by = 1, used_at = now() where code = 'TESTCODE';
  reset role;
  perform pg_temp.want((select count(*) from public.profiles) = n
    and (select is_active from public.telegram_agents where telegram_id = 1), '11 دعوة البوت تُستهلك وتفعّل بلا profiles');

  -- 12) RLS الفعلي للمسجّل الجديد، لا الدوال وحدها
  insert into public.categories (name) values ('فحص') returning id into n;
  insert into public.products (name, category_id) values ('منتج فحص', n) returning id into v_prod;
  update public.product_prices set price_retail = 1000, price_wholesale = 800 where product_id = v_prod;
  insert into public.stock_movements (product_id, type, singles_qty) values (v_prod, 'stock_in', 5);
  insert into public.delivery_zones (name, fee) values ('منطقة فحص', 2000) returning id into v_zone;
  perform public.create_order('زبون', '07700000000', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 1)), 'retail', v_zone);

  u := pg_temp.signup('rls@example.test'); perform pg_temp.confirm(u);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.want((select count(*) from public.orders) = 0, '12أ لا يقرأ الطلبات');
  perform pg_temp.want((select count(*) from public.products) = 0 and (select count(*) from public.product_prices) = 0
    and (select count(*) from public.stock_movements) = 0, '12ب لا يقرأ المنتجات ولا الأسعار ولا الحركات');
  update public.orders set status = 'confirmed';             get diagnostics n = row_count;
  perform pg_temp.want(n = 0, '12ج لا يؤكّد طلباً');
  update public.profiles set is_active = true, role = 'admin'; get diagnostics n = row_count;
  perform pg_temp.want(n = 0, '12د لا يفعّل نفسه');
  begin
    insert into public.profiles (id, role, is_active) values (gen_random_uuid(), 'admin', true);
    perform pg_temp.want(false, '12هـ لا يُدرج ملف موظف');
  exception when insufficient_privilege then perform pg_temp.want(true, '12هـ لا يُدرج ملف موظف');
  end;
  begin
    insert into public.products (name) values ('x');
    perform pg_temp.want(false, '12و لا يضيف منتجاً');
  exception when insufficient_privilege then perform pg_temp.want(true, '12و لا يضيف منتجاً');
  end;
  begin
    perform 1 from public.pending_roles;
    perform pg_temp.want(false, '12ز لا يقرأ pending_roles');
  exception when insufficient_privilege then perform pg_temp.want(true, '12ز لا يقرأ pending_roles');
  end;
  -- 13) وهو مسجّل الدخول يستطيع الشراء كزبون (FK على profiles) — سبب إبقاء الصف
  perform public.create_order('مروّج يشتري', '07700000000', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 1)), 'retail', v_zone);
  perform pg_temp.want(true, '13 المسجّل يطلب كزبون بلا خطأ FK');
  reset role;

  -- 14) المدير يفعّل موظفاً من خلال RLS
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set is_active = true where id = u;  get diagnostics n = row_count;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.want(n = 1 and pg_temp.rights(u) = 'staff,supervisor,zad', '14 المدير يفعّل موظفاً فيعمل');
end $$;

rollback;
\echo ALL-OK
