-- المشرف (data_entry) يؤكد الطلبات الجديدة ويستدعي كابتن زاد.
--
-- قرار المالك: يرى المشرف بيانات الطلبات (أسماء وأرقام ومبالغ) ليؤكد ويستدعي.
-- الحدّ الصارم: لا يغيّر شيئاً غير الحالة، ولا إلا من «جديد» إلى «مؤكَّد».
-- السياسات وحدها لا تكفي لتقييد الأعمدة، لذا مشغّل يرفض أي تعديل لغير status.
create or replace function public.is_supervisor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active and role in ('admin', 'data_entry'));
$$;

-- يقرأ طلبات الرفاعي (لا طلبات المنى — لها مديرها)
drop policy if exists "orders_supervisor_read" on public.orders;
create policy "orders_supervisor_read" on public.orders
  for select using (public.is_supervisor() and source <> 'mona');

-- تأكيد فقط: جديد ← مؤكَّد
drop policy if exists "orders_supervisor_confirm" on public.orders;
create policy "orders_supervisor_confirm" on public.orders
  for update using (public.is_supervisor() and source <> 'mona' and status = 'new')
  with check (status = 'confirmed');

create or replace function public.orders_supervisor_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- الخادم (cron، البوت، الدوال) والمدير ومدير المنى على طلباته: بلا قيد
  if auth.uid() is null or public.is_admin()
     or (old.source = 'mona' and coalesce(public.is_mona_admin(), false)) then
    return new;
  end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'المشرف يؤكّد الحالة فقط ولا يعدّل بيانات الطلب';
  end if;
  if not (old.status = 'new' and new.status = 'confirmed') then
    raise exception 'المشرف يؤكّد الطلبات الجديدة فقط';
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_supervisor_guard on public.orders;
create trigger trg_orders_supervisor_guard
  before update on public.orders
  for each row execute function public.orders_supervisor_guard();

-- يرى رحلات زاد لطلبات الرفاعي
drop policy if exists "zad_deliveries_supervisor" on public.zad_deliveries;
create policy "zad_deliveries_supervisor" on public.zad_deliveries
  for select using (
    public.is_supervisor()
    and exists (select 1 from public.orders o where o.id = order_id and o.source <> 'mona'));
