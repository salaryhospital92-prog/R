-- =====================================================================
-- 019 — متاجر المروّجين: الربح والاستحقاق وطلبات الاستلام (مسودة)
-- =====================================================================
-- القاعدة: كل تغيير مالي يقفل صفّ المتجر أولاً (reseller_lock)، والرصيد
-- مشتق من القيود دائماً. النظام لا ينقل مالاً؛ «تم التحويل» يسجّل ما فعله المدير.
--
--   pending   ربح طلبات لم تُسلَّم (لا قيد لها)
--   held      ربح سُلِّم طلبه ولم تنتهِ مهلته (available_at > now())
--   available = مجموع القيود التي حلّ وقتها − طلبات الاستلام المفتوحة
-- =====================================================================

-- no key update لا update: إدراج طلب جديد يقفل صفّ المتجر key share (مفتاح خارجي)
-- وهو ماسكٌ المنتجات؛ لو تعارضا لتشابك مع إلغاءٍ يمسك المتجر ويطلب المنتجات.
create or replace function public.reseller_lock(p_store uuid) returns public.reseller_stores
language sql security definer set search_path = public as $$
  select * from public.reseller_stores where id = p_store for no key update
$$;

-- ما حلّ وقته، قبل طرح المحجوز
create or replace function public.reseller_matured(p_store uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::bigint from public.reseller_ledger where store_id = p_store and available_at <= now()
$$;
create or replace function public.reseller_available(p_store uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select public.reseller_matured(p_store)
       - (select coalesce(sum(amount), 0)::bigint from public.reseller_payouts where store_id = p_store and status = 'open')
$$;

create or replace function public.reseller_mask(p text) returns text
language sql immutable set search_path = public as $$
  select case when length(p) > 4 then repeat('•', length(p) - 4) || right(p, 4) else '••••' end
$$;

-- من ينفّذ؟ مدير الرفاعي من الويب، أو البوت نيابةً عن مدير فعّال مسجَّل فيه
create or replace function public.reseller_actor(p_telegram_id bigint) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if public.is_admin() then return 'web:' || auth.uid(); end if;
  if coalesce(auth.role(), '') = 'service_role' and exists (
       select 1 from public.telegram_agents where telegram_id = p_telegram_id and is_active and role = 'admin') then
    return 'tg:' || p_telegram_id;
  end if;
  raise exception 'هذه العملية لمدير الرفاعي فقط';
end $$;

-- ---------------------------------------------------------------------
-- 1) إنشاء طلب استلام — المسار الوحيد، يدوياً وتلقائياً. يُستدعى والمتجر مقفل.
-- ---------------------------------------------------------------------
create or replace function public.reseller_open_payout(p_store public.reseller_stores, p_origin text, p_method text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_amount bigint; a public.reseller_payout_accounts; v_id uuid;
begin
  v_amount := public.reseller_available(p_store.id);
  if v_amount <= 0 then return null; end if;
  select * into a from public.reseller_payout_accounts
   where store_id = p_store.id and is_current and (p_method is null or method = p_method)
   order by seq desc limit 1;
  if not found then return null; end if;

  insert into public.reseller_payouts (store_id, account_id, amount, origin)
  values (p_store.id, a.id, v_amount, p_origin)
  on conflict (store_id) where status = 'open' do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  perform public.reseller_notify_admins('💸 طلب استلام أرباح' || case p_origin when 'auto' then ' (تلقائي)' else '' end
      || E'\nالمتجر: ' || p_store.name || E'\nالمبلغ: ' || to_char(v_amount, 'FM999,999,999') || ' د.ع'
      || E'\nالطريقة: ' || case a.method when 'zaincash' then 'زين كاش' else 'كي كارد' end || ' ' || public.reseller_mask(a.account_no)
      || case when a.created_at > now() - interval '72 hours' then E'\n⚠️ حساب الاستلام جديد أو تغيّر خلال 72 ساعة' else '' end,
    jsonb_build_array(jsonb_build_array(
      jsonb_build_object('text', '✅ تم التحويل', 'callback_data', 'rpok:' || v_id),
      jsonb_build_object('text', '✖️ رفض',       'callback_data', 'rpno:' || v_id))));
  return v_id;
end $$;

-- طلب أُلغي أو رُفض لا يُعاد تلقائياً بنفس المبلغ: إلا إن زاد المتاح، أو غيّر المروّج حسابه (p_force)
create or replace function public.reseller_auto_payout(p_store uuid, p_force boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.reseller_stores; v_min bigint; v_av bigint; last public.reseller_payouts;
begin
  s := public.reseller_lock(p_store);
  v_min := public.reseller_num('reseller_payout_threshold', 25000)::bigint;
  if s.status <> 'active' or v_min <= 0 then return null; end if;
  v_av := public.reseller_available(p_store);
  if v_av < v_min then return null; end if;
  select * into last from public.reseller_payouts where store_id = p_store order by seq desc limit 1;
  if not p_force and last.status in ('cancelled', 'rejected') and v_av <= last.amount then return null; end if;
  return public.reseller_open_payout(s, 'auto', null);
end $$;

-- المهلة تنتهي بلا حدث، فتُفحص دورياً (cron كل ربع ساعة)
create or replace function public.reseller_auto_payouts() returns int
language plpgsql security definer set search_path = public as $$
declare v uuid; n int := 0;
begin
  for v in select id from public.reseller_stores where status = 'active' order by id loop
    if public.reseller_auto_payout(v) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 2) الربح يتبع حالة الطلب. فشله يُفشل تغيير الحالة عمداً؛ وzad_poll يعيد
--    المحاولة كل دقيقة لكل رحلة على حدة.
-- ---------------------------------------------------------------------
create or replace function public.reseller_on_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare ro public.reseller_orders;
begin
  perform public.reseller_lock(new.reseller_store_id);

  if old.status = 'delivered' then
    -- عكس الدورة الحالية. بنفس وقت الاستحقاق: ما لم يحلّ بعد يُصفَّر معه.
    insert into public.reseller_ledger (store_id, kind, amount, available_at, order_id, cycle, note)
    select l.store_id, 'reversal', -l.amount, l.available_at, l.order_id, l.cycle, 'الحالة صارت ' || new.status
      from public.reseller_ledger l join public.reseller_orders o on o.order_id = l.order_id and o.cycle = l.cycle
     where l.order_id = new.id and l.kind = 'profit_due'
    on conflict (order_id, kind, cycle) where order_id is not null do nothing;
  end if;

  if new.status = 'delivered' then
    update public.reseller_orders set cycle = cycle + 1 where order_id = new.id returning * into ro;
    if ro.profit > 0 then
      insert into public.reseller_ledger (store_id, kind, amount, available_at, order_id, cycle)
      values (ro.store_id, 'profit_due', ro.profit,
              now() + make_interval(secs => (public.reseller_num('reseller_hold_days', 3) * 86400)::double precision), ro.order_id, ro.cycle);
    end if;
    perform public.reseller_auto_payout(new.reseller_store_id);
  end if;
  return null;
end $$;
create trigger trg_reseller_on_status after update of status on public.orders
  for each row when (new.source = 'reseller' and old.status is distinct from new.status)
  execute function public.reseller_on_status();

-- ---------------------------------------------------------------------
-- 3) المروّج
-- ---------------------------------------------------------------------
create or replace function public.reseller_balance() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'pending',   (select coalesce(sum(ro.profit), 0) from public.reseller_orders ro join public.orders o on o.id = ro.order_id
                   where ro.store_id = s.id and o.status in ('new', 'confirmed')),
    'held',      (select coalesce(sum(amount), 0) from public.reseller_ledger where store_id = s.id and available_at > now()),
    'available', public.reseller_available(s.id),
    'reserved',  (select coalesce(sum(amount), 0) from public.reseller_payouts where store_id = s.id and status = 'open'),
    'paid',      (select coalesce(-sum(amount), 0) from public.reseller_ledger where store_id = s.id and kind = 'payout'),
    'threshold', public.reseller_num('reseller_payout_threshold', 25000),
    'hold_days', public.reseller_num('reseller_hold_days', 3))
    from public.reseller_stores s where s.owner_id = auth.uid()
$$;

create or replace function public.reseller_save_payout_account(p_method text, p_account_no text, p_holder text) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.reseller_stores; v_no text; v_id uuid;
begin
  s := public.reseller_lock(public.reseller_my_store());
  if s.id is null then raise exception 'أنشئ متجرك أولاً'; end if;
  if s.status = 'suspended' then raise exception 'متجرك موقوف — راجع الإدارة'; end if;

  v_no := regexp_replace(translate(coalesce(p_account_no, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[\s-]', '', 'g');
  if p_method = 'zaincash' then
    v_no := regexp_replace(v_no, '^(\+|00)?964', '0');
    if v_no !~ '^07\d{9}$' then raise exception 'رقم زين كاش غير صحيح'; end if;
  elsif p_method = 'qicard' then
    if v_no ~ '^\d{16,}$' then raise exception 'هذا رقم بطاقة — أدخل رقم الحساب فقط، ولا ترسل رقم البطاقة لأحد'; end if;
    if v_no !~ '^\d{6,15}$' then raise exception 'رقم حساب كي كارد غير صحيح'; end if;
  else
    raise exception 'طريقة الاستلام غير معروفة';
  end if;
  if coalesce(p_holder, '') ~ '\d{4}' or length(trim(coalesce(p_holder, ''))) not between 2 and 80 then
    raise exception 'اسم صاحب الحساب غير صحيح';
  end if;

  select id into v_id from public.reseller_payout_accounts
   where store_id = s.id and method = p_method and is_current and account_no = v_no and holder_name = trim(p_holder);
  if v_id is not null then return v_id; end if;

  update public.reseller_payout_accounts set is_current = false where store_id = s.id and method = p_method and is_current;
  insert into public.reseller_payout_accounts (store_id, method, account_no, holder_name)
  values (s.id, p_method, v_no, trim(p_holder)) returning id into v_id;

  insert into public.reseller_audit (store_id, actor, action, detail)
  values (s.id, 'owner:' || auth.uid(), 'account_changed', p_method || ' ' || public.reseller_mask(v_no));
  perform public.reseller_notify_admins('🔐 متجر «' || s.name || '» غيّر حساب الاستلام: '
    || case p_method when 'zaincash' then 'زين كاش' else 'كي كارد' end || ' ' || public.reseller_mask(v_no));
  perform public.reseller_auto_payout(s.id, true);
  return v_id;
end $$;

create or replace function public.reseller_request_payout(p_method text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.reseller_stores; v_id uuid;
begin
  s := public.reseller_lock(public.reseller_my_store());
  if s.id is null then raise exception 'أنشئ متجرك أولاً'; end if;
  if s.status <> 'active' then raise exception 'متجرك غير فعّال'; end if;
  if exists (select 1 from public.reseller_payouts where store_id = s.id and status = 'open') then
    raise exception 'لديك طلب استلام مفتوح';
  end if;
  if public.reseller_available(s.id) <= 0 then raise exception 'لا رصيد متاح للاستلام'; end if;
  v_id := public.reseller_open_payout(s, 'manual', p_method);
  if v_id is null then raise exception 'أدخل حساب الاستلام أولاً'; end if;
  return v_id;
end $$;

create or replace function public.reseller_cancel_payout(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_store uuid := public.reseller_my_store();
begin
  perform public.reseller_lock(v_store);
  update public.reseller_payouts set status = 'cancelled', decided_by = 'owner:' || auth.uid(), decided_at = now()
   where id = p_id and store_id = v_store and status = 'open';
  if not found then raise exception 'الطلب غير موجود أو عولج سابقاً'; end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) مدير الرفاعي (ويب أو بوت)
-- ---------------------------------------------------------------------
create or replace function public.reseller_decide_store(p_store uuid, p_action text, p_reason text default null, p_telegram_id bigint default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_actor text := public.reseller_actor(p_telegram_id); s public.reseller_stores; v_from text[]; v_to text;
begin
  s := public.reseller_lock(p_store);
  if s.id is null then raise exception 'المتجر غير موجود'; end if;
  select f, t into v_from, v_to from (values
    ('activate', array['pending'],   'active'),
    ('reject',   array['pending'],   'rejected'),
    ('suspend',  array['active'],    'suspended'),
    ('resume',   array['suspended'], 'active')) m(a, f, t) where a = p_action;
  if v_to is null then raise exception 'إجراء غير معروف'; end if;
  if s.status <> all (v_from) then
    raise exception 'عولج سابقاً — الحالة الآن: %', s.status;
  end if;
  if p_action in ('reject', 'suspend') and length(trim(coalesce(p_reason, ''))) < 2 then raise exception 'اكتب السبب'; end if;

  update public.reseller_stores set status = v_to, status_reason = left(trim(p_reason), 300), decided_by = v_actor, decided_at = now() where id = s.id;
  insert into public.reseller_audit (store_id, actor, action, detail) values (s.id, v_actor, p_action, left(p_reason, 300));
  if v_to = 'active' then perform public.reseller_auto_payout(s.id); end if;
  return v_to;
end $$;

create or replace function public.reseller_payout_paid(p_id uuid, p_reference text, p_telegram_id bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.reseller_actor(p_telegram_id); v_store uuid; p public.reseller_payouts;
begin
  if length(trim(coalesce(p_reference, ''))) < 2 then raise exception 'اكتب مرجع التحويل'; end if;
  select store_id into v_store from public.reseller_payouts where id = p_id;
  if v_store is null then raise exception 'طلب الاستلام غير موجود'; end if;
  perform public.reseller_lock(v_store);
  select * into p from public.reseller_payouts where id = p_id;
  if p.status <> 'open' then raise exception 'عولج سابقاً — الحالة الآن: %', p.status; end if;
  -- إلغاء طلب بعد الحجز قد ينقص المستحق: لا يُدفع أكثر منه
  if public.reseller_matured(v_store) < p.amount then
    raise exception 'تغيّر المستحق بعد إلغاء طلب — ارفض طلب الاستلام ليُحسب من جديد';
  end if;
  update public.reseller_payouts set status = 'paid', reference = left(trim(p_reference), 100), decided_by = v_actor, decided_at = now() where id = p_id;
  insert into public.reseller_ledger (store_id, kind, amount, payout_id, created_by) values (v_store, 'payout', -p.amount, p_id, v_actor);
  perform public.reseller_auto_payout(v_store);
end $$;

create or replace function public.reseller_payout_reject(p_id uuid, p_reason text, p_telegram_id bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor text := public.reseller_actor(p_telegram_id); v_store uuid;
begin
  if length(trim(coalesce(p_reason, ''))) < 2 then raise exception 'اكتب السبب'; end if;
  select store_id into v_store from public.reseller_payouts where id = p_id;
  if v_store is null then raise exception 'طلب الاستلام غير موجود'; end if;
  perform public.reseller_lock(v_store);
  update public.reseller_payouts set status = 'rejected', reason = left(trim(p_reason), 300), decided_by = v_actor, decided_at = now()
   where id = p_id and status = 'open';
  if not found then raise exception 'عولج سابقاً'; end if;
end $$;

-- كشف الحساب الكامل: من الويب فقط، ولطلب مفتوح، ويُسجَّل
create or replace function public.reseller_payout_reveal(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.reseller_payout_accounts;
begin
  if not public.is_admin() then raise exception 'هذه العملية لمدير الرفاعي فقط'; end if;
  select ac.* into a from public.reseller_payouts p join public.reseller_payout_accounts ac on ac.id = p.account_id
   where p.id = p_id and p.status = 'open';
  if not found then raise exception 'طلب الاستلام غير مفتوح'; end if;
  insert into public.reseller_audit (store_id, actor, action, detail) values (a.store_id, 'web:' || auth.uid(), 'account_revealed', p_id::text);
  return jsonb_build_object('method', a.method, 'account_no', a.account_no, 'holder_name', a.holder_name, 'since', a.created_at);
end $$;

create or replace function public.reseller_adjust(p_store uuid, p_amount bigint, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_actor text := public.reseller_actor(null); s public.reseller_stores;
begin
  if length(trim(coalesce(p_note, ''))) < 3 then raise exception 'اكتب سبب التسوية'; end if;
  if coalesce(p_amount, 0) = 0 or abs(p_amount) > 10000000 then raise exception 'مبلغ غير صالح'; end if;
  s := public.reseller_lock(p_store);
  if s.id is null then raise exception 'المتجر غير موجود'; end if;
  insert into public.reseller_ledger (store_id, kind, amount, note, created_by) values (p_store, 'adjustment', p_amount, left(trim(p_note), 300), v_actor);
  perform public.reseller_auto_payout(p_store);
end $$;

-- ---------------------------------------------------------------------
revoke all on function public.reseller_lock(uuid), public.reseller_matured(uuid), public.reseller_available(uuid), public.reseller_mask(text),
  public.reseller_actor(bigint), public.reseller_open_payout(public.reseller_stores, text, text), public.reseller_auto_payout(uuid, boolean),
  public.reseller_auto_payouts(), public.reseller_on_status(), public.reseller_balance(),
  public.reseller_save_payout_account(text, text, text), public.reseller_request_payout(text), public.reseller_cancel_payout(uuid),
  public.reseller_decide_store(uuid, text, text, bigint), public.reseller_payout_paid(uuid, text, bigint),
  public.reseller_payout_reject(uuid, text, bigint), public.reseller_payout_reveal(uuid), public.reseller_adjust(uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.reseller_balance(), public.reseller_save_payout_account(text, text, text),
  public.reseller_request_payout(text), public.reseller_cancel_payout(uuid),
  public.reseller_decide_store(uuid, text, text, bigint), public.reseller_payout_paid(uuid, text, bigint),
  public.reseller_payout_reject(uuid, text, bigint), public.reseller_payout_reveal(uuid), public.reseller_adjust(uuid, bigint, text)
  to authenticated;

select cron.schedule('reseller-auto-payouts', '*/15 * * * *', $$select public.reseller_auto_payouts()$$);
