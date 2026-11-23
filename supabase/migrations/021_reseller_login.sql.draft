-- =====================================================================
-- 021 — متاجر المروّجين: الدخول عبر تيليغرام والبدء السريع  (مسودة — لم تُطبَّق)
-- =====================================================================
-- المسار: الصفحة تطلب رمزاً ← يفتح المروّج البوت (/start login_<رمز>) ← يضغط الرقم الظاهر على شاشته
-- ← (أول مرة) يشارك جهة اتصاله ← الصفحة تُكمل بجلسة عادية. دالة الحافة reseller-login تنفّذ المسار
-- بمفتاح الخدمة؛ كل المنطق الحساس هنا في دوال لا يستدعيها غير service_role.
-- المستخدم يبقى صفاً في auth.users فكل RLS في 017–020 يعمل كما هو.
-- =====================================================================
set local lock_timeout = '5s';

-- حارس: دالة الحافة تنشئ مستخدمين في auth.users، وبلا 015 يصير كل مروّج موظف رفاعي (profile فعّال بدور data_entry:
-- كل الطلبات وهواتف الزبائن وتعديل المنتجات). لذلك لا يُطبَّق هذا الملف قبل 015 أبداً.
do $$ begin
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_active') is distinct from 'false'
     or pg_get_functiondef('public.handle_new_user'::regproc) !~ 'values \(new\.id,[^;]*, false\)' then
    raise exception '021 يتطلب 015 (إغلاق ثغرة التسجيل) أولاً — وإلا صار كل مروّج موظفاً';
  end if;
end $$;

insert into public.app_settings (key, value) values
  ('reseller_default_markup_percent', '20')      -- الزيادة المقترحة في المعالج؛ قرار المالك (افتراض معمول به)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- الهوية: تيليغرام ↔ مستخدم. الهاتف موثَّق من جهة اتصال تيليغرام نفسها.
-- ---------------------------------------------------------------------
create table public.reseller_identities (
  telegram_id   bigint primary key,
  user_id       uuid not null unique references auth.users(id) on delete restrict,
  name          text check (length(name) <= 80),
  phone         text check (phone ~ '^9647\d{9}$'),
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- محاولات الدخول: الصفحة تحتفظ بالسر (ويُخزَّن مجزَّأً) والبوت يحمل الرمز العلني.
create table public.reseller_logins (
  nonce       text primary key,
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  number      int  not null check (number between 10 and 99),
  options     int[],
  state       text not null default 'waiting' check (state in ('waiting', 'claimed', 'need_phone', 'confirmed', 'done', 'failed')),
  telegram_id bigint,
  tg_name     text,
  tg_phone    text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '3 minutes'
);
create index on public.reseller_logins (created_at);
create index on public.reseller_logins (telegram_id) where state = 'need_phone';

alter table public.reseller_identities enable row level security;
alter table public.reseller_logins enable row level security;
revoke all on public.reseller_identities, public.reseller_logins from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- مسار الدخول (service_role وحده)
-- ---------------------------------------------------------------------
create or replace function public.reseller_login_new(p_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_nonce text; v_num int := 10 + floor(random() * 90)::int;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'طلب غير صالح'; end if;
  perform pg_advisory_xact_lock(hashtext('reseller_login_new'));
  if (select count(*) from public.reseller_logins where created_at > now() - interval '1 minute') >= 100 then
    raise exception 'محاولات كثيرة — انتظر دقيقة';
  end if;
  delete from public.reseller_logins where created_at < now() - interval '1 hour';
  v_nonce := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  insert into public.reseller_logins (nonce, secret_hash, number) values (v_nonce, p_hash, v_num);
  return jsonb_build_object('nonce', v_nonce, 'number', v_num, 'expires_in', 180);
end $$;

-- البوت: أول من يضغط Start يحجز المحاولة (الثاني لا يغيّرها). يعيد ثلاثة أرقام مرتبة عشوائياً.
create or replace function public.reseller_login_claim(p_nonce text, p_telegram_id bigint, p_name text) returns int[]
language plpgsql security definer set search_path = public as $$
declare l public.reseller_logins; d1 int; d2 int; v int[];
begin
  select * into l from public.reseller_logins where nonce = p_nonce for update;
  if not found or l.state <> 'waiting' or l.expires_at <= now() then return null; end if;
  loop d1 := 10 + floor(random() * 90)::int; exit when d1 <> l.number; end loop;
  loop d2 := 10 + floor(random() * 90)::int; exit when d2 not in (l.number, d1); end loop;
  select array_agg(x order by random()) into v from unnest(array[l.number, d1, d2]) x;
  update public.reseller_logins set state = 'claimed', telegram_id = p_telegram_id, tg_name = left(p_name, 80), options = v
   where nonce = p_nonce;
  return v;
end $$;

-- مطابقة الرقم: خطأ واحد يُلغي المحاولة (ضد التصيّد: من فتح رابط غيره لا يعرف الرقم)
create or replace function public.reseller_login_pick(p_nonce text, p_telegram_id bigint, p_pick int) returns text
language plpgsql security definer set search_path = public as $$
declare l public.reseller_logins; v_phone text;
begin
  select * into l from public.reseller_logins where nonce = p_nonce for update;
  if not found or l.state <> 'claimed' or l.expires_at <= now() or l.telegram_id is distinct from p_telegram_id then return 'expired'; end if;
  if p_pick is distinct from l.number then
    update public.reseller_logins set state = 'failed' where nonce = p_nonce;
    return 'wrong';
  end if;
  select phone into v_phone from public.reseller_identities where telegram_id = p_telegram_id;
  if v_phone is not null then
    update public.reseller_logins set state = 'confirmed', tg_phone = v_phone where nonce = p_nonce;
    return 'confirmed';
  end if;
  update public.reseller_logins set state = 'need_phone' where nonce = p_nonce;
  return 'need_phone';
end $$;

-- جهة الاتصال: تُقبل إن كانت لصاحب الحساب نفسه (contact.user_id = from.id) ورقماً عراقياً
create or replace function public.reseller_login_phone(p_telegram_id bigint, p_contact_user_id bigint, p_phone text) returns text
language plpgsql security definer set search_path = public as $$
declare v_phone text; v_nonce text;
begin
  if p_contact_user_id is distinct from p_telegram_id then return 'not_yours'; end if;
  v_phone := public.zad_canonical_phone(p_phone);
  if v_phone is null or v_phone !~ '^9647\d{9}$' then return 'bad_phone'; end if;
  select nonce into v_nonce from public.reseller_logins
   where telegram_id = p_telegram_id and state = 'need_phone' and expires_at > now()
   order by created_at desc limit 1 for update;
  if v_nonce is null then return 'expired'; end if;
  update public.reseller_logins set state = 'confirmed', tg_phone = v_phone where nonce = v_nonce;
  return 'ok';
end $$;

-- الصفحة تستعلم بسرّها: لمرة واحدة عند التأكيد. أي سر خاطئ = «منتهية» (لا نكشف وجود الرمز).
create or replace function public.reseller_login_poll(p_nonce text, p_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.reseller_logins;
begin
  select * into l from public.reseller_logins where nonce = p_nonce for update;
  if not found or l.secret_hash is distinct from p_hash or l.expires_at <= now() or l.state = 'done' then
    return jsonb_build_object('status', 'expired');
  end if;
  if l.state = 'failed' then return jsonb_build_object('status', 'failed'); end if;
  if l.state <> 'confirmed' then return jsonb_build_object('status', 'waiting', 'state', l.state); end if;
  update public.reseller_logins set state = 'done' where nonce = p_nonce;
  return jsonb_build_object('status', 'ok', 'telegram_id', l.telegram_id, 'name', l.tg_name, 'phone', l.tg_phone,
    'user_id', (select user_id from public.reseller_identities where telegram_id = l.telegram_id));
end $$;

-- بعد إنشاء مستخدم auth (أو إيجاده): تثبيت الهوية. الهاتف الأحدث الموثَّق يحلّ محل القديم.
create or replace function public.reseller_identity_save(p_telegram_id bigint, p_user_id uuid, p_name text, p_phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  insert into public.reseller_identities (telegram_id, user_id, name, phone, last_login_at)
  values (p_telegram_id, p_user_id, left(p_name, 80), p_phone, now())
  on conflict (telegram_id) do update set name = excluded.name, phone = coalesce(excluded.phone, reseller_identities.phone), last_login_at = now()
  returning user_id into v_user;
  return v_user;
end $$;

-- ---------------------------------------------------------------------
-- المروّج (authenticated): من أنا، والبدء السريع
-- ---------------------------------------------------------------------
create or replace function public.reseller_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('telegram_id', i.telegram_id, 'name', i.name,
    'phone', case when i.phone is not null then '0' || substr(i.phone, 4) end,
    'store', (select jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name, 'status', s.status, 'status_reason', s.status_reason,
                'theme_color', s.theme_color, 'logo_path', s.logo_path,
                'whatsapp', case when s.whatsapp is not null then '0' || substr(s.whatsapp, 4) end, 'about', s.about,
                'markup_type', s.markup_type, 'markup_value', s.markup_value, 'round_to', s.round_to)
                from public.reseller_stores s where s.owner_id = i.user_id),
    'default_markup', public.reseller_num('reseller_default_markup_percent', 20))
    from public.reseller_identities i where i.user_id = auth.uid()
$$;

-- الاسم العربي → رابط لاتيني (تقريبي). فارغ أو قصير ← 'shop'.
create or replace function public.reseller_slugify(p_name text) returns text
language sql immutable set search_path = public as $$
  select case when length(s) >= 3 then left(s, 24) else 'shop' end
    from (select trim(both '-' from regexp_replace(regexp_replace(translate(
            replace(replace(replace(replace(replace(replace(replace(replace(lower(trim(p_name)),
              'ث', 'th'), 'ج', 'j'), 'خ', 'kh'), 'ذ', 'dh'), 'ش', 'sh'), 'غ', 'gh'), 'ص', 's'), 'ض', 'd'),
            'طظعحاأإآبتدرزسفقكلمنهةويىؤئء', 'tzahaaiabtdrzsfqklmnhawyaway'),
          '[^a-z0-9]+', '-', 'g'), '-{2,}', '-', 'g')) as s) x
$$;

-- رابط حرّ: الأساس ثم -2.. ثم رقم عشوائي. يلتزم بقواعد الرابط (محجوز/انتحال).
create or replace function public.reseller_free_slug(p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare b text := public.reseller_slugify(p_name); c text; i int := 1;
begin
  if public.reseller_slug_ok(b) is not true then b := 'shop'; end if;
  loop
    c := case when i = 1 then b when i <= 9 then left(b, 26) || '-' || i else left(b, 24) || '-' || (1000 + floor(random() * 9000))::int end;
    if public.reseller_slug_ok(c) and not exists (select 1 from public.reseller_stores where slug = c) then return c; end if;
    i := i + 1;
    if i > 30 then raise exception 'تعذّر توليد رابط — جرّب اسماً آخر'; end if;
  end loop;
end $$;

-- أنشئ متجري: الاسم فقط. الباقي افتراضات تُعدَّل لاحقاً (كل الأصناف، الزيادة المقترحة، لون، رقم تيليغرام الموثَّق).
create or replace function public.reseller_quick_start(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.reseller_identities; s public.reseller_stores; v_name text := trim(coalesce(p_name, ''));
        v_id uuid; v_slug text; n int := 0;
        v_colors text[] := array['#059669', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#4f46e5', '#b45309'];
begin
  select * into i from public.reseller_identities where user_id = auth.uid();
  if not found then raise exception 'سجّل الدخول عبر تيليغرام أولاً'; end if;
  if i.phone is null then raise exception 'شارك رقمك من تيليغرام أولاً'; end if;
  if length(v_name) not between 2 and 40 then raise exception 'اسم المتجر من حرفين إلى 40 حرفاً'; end if;

  select * into s from public.reseller_stores where owner_id = auth.uid() for no key update;
  if found then
    if s.status = 'draft' and s.name <> v_name then update public.reseller_stores set name = v_name where id = s.id; end if;
    return s.id;
  end if;

  loop
    v_slug := public.reseller_free_slug(v_name);
    begin
      insert into public.reseller_stores (owner_id, slug, name, phone, theme_color, markup_type, markup_value, round_to)
      values (auth.uid(), v_slug, v_name, i.phone, v_colors[1 + abs(hashtext(v_name)) % 8], 'percent',
              least(1000, public.reseller_num('reseller_default_markup_percent', 20)::bigint), 250)
      returning id into v_id;
      exit;
    exception when unique_violation then
      n := n + 1;
      if n > 5 then raise; end if;          -- سباق على الرابط: نعيد التوليد
    end;
  end loop;

  insert into public.reseller_categories (store_id, category_id)
  select v_id, c.id from public.categories c
   where c.store = 'rifai' and exists (select 1 from public.products p where p.category_id = c.id and p.is_active and p.store = 'rifai');

  -- الدخول نفسه يربط إشعارات تيليغرام (محادثة خاصة: المعرّف نفسه)
  insert into public.reseller_telegram (store_id, chat_id, linked_at) values (v_id, i.telegram_id, now())
  on conflict do nothing;
  return v_id;
end $$;

-- أصناف الإعدادات: كل ما يمكن بيعه وأيها مختار. دالة بدل قراءة جدول categories مباشرة (لا يعرف المتصفح مفتاح المتجر الداخلي).
create or replace function public.reseller_category_list() returns table (id int, name text, selected boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, exists (select 1 from public.reseller_categories rc where rc.category_id = c.id and rc.store_id = public.reseller_my_store())
    from public.categories c
   where public.reseller_my_store() is not null and c.store = 'rifai'
     and exists (select 1 from public.products p where p.category_id = c.id and p.is_active and p.store = 'rifai')
   order by c.name
$$;

-- ---------------------------------------------------------------------
-- الصلاحيات: كل دالة جديدة بقرار صريح
-- ---------------------------------------------------------------------
revoke all on function public.reseller_login_new(text), public.reseller_login_claim(text, bigint, text),
  public.reseller_login_pick(text, bigint, int), public.reseller_login_phone(bigint, bigint, text),
  public.reseller_login_poll(text, text), public.reseller_identity_save(bigint, uuid, text, text),
  public.reseller_me(), public.reseller_slugify(text), public.reseller_free_slug(text), public.reseller_quick_start(text),
  public.reseller_category_list()
  from public, anon, authenticated;
grant execute on function public.reseller_login_new(text), public.reseller_login_claim(text, bigint, text),
  public.reseller_login_pick(text, bigint, int), public.reseller_login_phone(bigint, bigint, text),
  public.reseller_login_poll(text, text), public.reseller_identity_save(bigint, uuid, text, text) to service_role;
grant execute on function public.reseller_me(), public.reseller_quick_start(text), public.reseller_category_list() to authenticated;
