-- =====================================================================
-- 022 — أسرار بوت المروّجين في جدول مغلق  (مسودة — لم تُطبَّق)
-- =====================================================================
-- لوحة Supabase (أسرار الدوال) ليست في متناول المالك عن بعد، وكلمة سر القاعدة متاحة. فالرمز ومعرّف البوت وسرّ
-- الويبهوك تُحفظ هنا: جدول بلا أي منحة (حتى service_role) تقرؤه دالة واحدة لمفتاح الخدمة وحده، فلا يصل إليها
-- المتصفح ولا الزائر ولا موظف الرفاعي. تُكتب بدور postgres (سكربت النشر) لا من أي واجهة.
-- =====================================================================
set local lock_timeout = '5s';

create table public.reseller_secrets (
  key        text primary key check (key in ('bot_token', 'bot_username', 'webhook_secret')),
  value      text not null check (length(value) between 1 and 200),
  updated_at timestamptz not null default now()
);
alter table public.reseller_secrets enable row level security;
revoke all on public.reseller_secrets from public, anon, authenticated, service_role;

create or replace function public.reseller_secret(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select value from public.reseller_secrets where key = p_key
$$;
revoke all on function public.reseller_secret(text) from public, anon, authenticated;
grant execute on function public.reseller_secret(text) to service_role;
