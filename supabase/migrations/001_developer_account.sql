-- حساب المطوّر: دور يُمنح تلقائياً لحظة إنشاء الحساب.
--
-- كلمة المرور لا يضعها غير صاحب الحساب. تُنشئ الحساب من لوحة Supabase
-- (Authentication ← Users ← Add user) أو بأي طريقة، فيأخذ الدور فور ظهوره
-- في auth.users دون أي خطوة أخرى — لا سباق ولا انتظار.
--
-- دور admin يعني صلاحية كاملة: الرفاعي، والمنى (is_mona_admin يشمل admin)،
-- والتوصيل مع زاد، والتقارير، والأسعار، والمستخدمين.
create table if not exists public.pending_roles (
  email     text primary key,
  role      public.user_role not null,
  full_name text not null default ''
);
alter table public.pending_roles enable row level security;
revoke all on public.pending_roles from anon, authenticated;   -- لا سياسة = لا وصول من المتصفح

create or replace function public.apply_pending_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare pr public.pending_roles;
begin
  select * into pr from public.pending_roles where email = lower(new.email);
  if found then
    insert into public.profiles (id, full_name, role, is_active)
    values (new.id, pr.full_name, pr.role, true)
    on conflict (id) do update set role = excluded.role, is_active = true,
      full_name = coalesce(nullif(public.profiles.full_name, ''), excluded.full_name);
    delete from public.pending_roles where email = pr.email;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_pending_role on auth.users;
create trigger on_auth_user_pending_role
  after insert on auth.users
  for each row execute function public.apply_pending_role();

insert into public.pending_roles (email, role, full_name)
values ('ahmed@ahmed.com', 'admin', 'المطوّر')
on conflict (email) do update set role = excluded.role, full_name = excluded.full_name;

-- لو كان الحساب موجوداً أصلاً يُمنح الدور الآن
do $$
declare u record;
begin
  for u in select id from auth.users where lower(email) = 'ahmed@ahmed.com' loop
    insert into public.profiles (id, full_name, role, is_active) values (u.id, 'المطوّر', 'admin', true)
    on conflict (id) do update set role = 'admin', is_active = true;
    delete from public.pending_roles where email = 'ahmed@ahmed.com';
  end loop;
end $$;
