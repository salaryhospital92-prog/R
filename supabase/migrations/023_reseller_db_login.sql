-- =====================================================================
-- 023 — دخول المروّجين عبر تيليغرام داخل القاعدة وحدها  (مسودة — لم تُطبَّق)
-- =====================================================================
-- بديل دالة الحافة (لا صلاحية نشر متاحة للمالك):
--   • تيليغرام يرسل التحديثات إلى PostgREST: POST /rest/v1/rpc/reseller_bot_webhook (الجسم كله وسيط واحد)،
--     ويُتحقق من ترويسة X-Telegram-Bot-Api-Secret-Token؛ والرد يعود في الاستجابة نفسها (webhook reply).
--   • الجلسة: بعد التأكيد تعطي القاعدةُ الصفحةَ كلمة سر عشوائية لمستخدم auth خاص بها، فتدخل بـsignInWithPassword،
--     ثم تُبدَّل كلمة السر فوراً (reseller_login_seal). لا مفتاح خدمة ولا دالة حافة.
-- يكتب هذا الملف في auth.users وauth.identities مباشرةً (الأعمدة مطابقة للحيّ، ومُجرَّبة على GoTrue حقيقي محلياً).
-- =====================================================================
set local lock_timeout = '5s';

-- نفس حارس 021: بلا 015 يصير كل مستخدم جديد موظفاً
do $$ begin
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_active') is distinct from 'false' then
    raise exception '023 يتطلب 015 (إغلاق ثغرة التسجيل) أولاً';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1) الصفحة (anon): بدء المحاولة وإنهاؤها بالسر الذي لا يغادر المتصفح إلا إلى القاعدة
-- ---------------------------------------------------------------------
create or replace function public.reseller_login_start(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_bot text := public.reseller_secret('bot_username');
begin
  if p_secret is null or p_secret !~ '^[0-9a-f]{32,128}$' then raise exception 'طلب غير صالح'; end if;
  if v_bot is null then raise exception 'الدخول غير مفعّل بعد'; end if;
  r := public.reseller_login_new(encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'));
  return r || jsonb_build_object('bot', 'https://t.me/' || v_bot || '?start=login_' || (r->>'nonce'));
end $$;

create or replace function public.reseller_login_finish(p_nonce text, p_secret text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r jsonb; v_tg bigint; v_user uuid; v_email text; v_pass text;
begin
  r := public.reseller_login_poll(p_nonce, encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex'));
  if r->>'status' <> 'ok' then return jsonb_build_object('status', r->>'status'); end if;
  v_tg := (r->>'telegram_id')::bigint;
  v_user := (r->>'user_id')::uuid;
  v_pass := encode(gen_random_bytes(32), 'hex');

  if v_user is null then
    v_email := 'tg' || v_tg || '@telegram.invalid';
    select id into v_user from auth.users where email = v_email;
  end if;

  if v_user is null then
    v_user := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated', v_email,
            crypt(v_pass, gen_salt('bf')), now(),
            jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'reseller_tg', v_tg::text), '{}'::jsonb, now(), now(),
            '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_user::text, v_user, jsonb_build_object('sub', v_user::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  else
    -- عائد: كلمة سر جديدة لهذه الجلسة فقط. لا يُمسّ حساب لا يحمل علامتنا (موظف، أو بريد سجّله غيرنا قبلنا):
    -- app_metadata لا يضبطها المستخدم نفسه
    update auth.users set encrypted_password = crypt(v_pass, gen_salt('bf')), updated_at = now()
     where id = v_user and raw_app_meta_data->>'reseller_tg' = v_tg::text
    returning email into v_email;
    if v_email is null then raise exception 'تعذّر الدخول — راجع الإدارة'; end if;
  end if;

  perform public.reseller_identity_save(v_tg, v_user, r->>'name', r->>'phone');
  return jsonb_build_object('status', 'ok', 'email', v_email, 'password', v_pass);
end $$;

-- بعد الدخول مباشرة: كلمة السر التي رآها المتصفح تُبدَّل بعشوائية لا يعرفها أحد (الجلسة تبقى)
create or replace function public.reseller_login_seal() returns void
language sql security definer set search_path = public, extensions as $$
  update auth.users set encrypted_password = crypt(encode(gen_random_bytes(32), 'hex'), gen_salt('bf')), updated_at = now()
   where id = auth.uid() and raw_app_meta_data ? 'reseller_tg'
$$;

-- ---------------------------------------------------------------------
-- 2) البوت: تحديث تيليغرام كله في وسيط واحد (PostgREST يمرّر الجسم)، والرد هو الاستجابة
-- ---------------------------------------------------------------------
create or replace function public.reseller_bot_webhook(jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  u jsonb := $1; v_secret text := public.reseller_secret('webhook_secret'); v_given text;
  msg jsonb := $1->'message'; cbq jsonb := $1->'callback_query';
  v_from jsonb; v_chat jsonb; v_tg bigint; v_name text; v_text text; v_res text; v_opts int[]; v_nonce text;
begin
  v_given := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-telegram-bot-api-secret-token';
  if v_secret is null or v_given is distinct from v_secret then return '{}'::jsonb; end if;

  v_from := coalesce(msg->'from', cbq->'from');
  v_chat := coalesce(msg->'chat', cbq->'message'->'chat');
  if v_from is null or v_chat->>'type' is distinct from 'private' then return '{}'::jsonb; end if;
  v_tg := (v_from->>'id')::bigint;
  v_name := concat_ws(' ', v_from->>'first_name', v_from->>'last_name');

  if cbq is not null then
    -- إيقاف دوران الزر (أفضل جهد؛ الرد الأساسي في الاستجابة)
    begin
      perform net.http_post(url := 'https://api.telegram.org/bot' || public.reseller_secret('bot_token') || '/answerCallbackQuery',
        body := jsonb_build_object('callback_query_id', cbq->>'id'));
    exception when others then null;
    end;
    if coalesce(cbq->>'data', '') !~ '^lp:[0-9a-f]{16}:\d{2}$' then return '{}'::jsonb; end if;
    v_res := public.reseller_login_pick(split_part(cbq->>'data', ':', 2), v_tg, split_part(cbq->>'data', ':', 3)::int);
    v_text := case v_res when 'confirmed' then 'تم ✅ ارجع الآن إلى المتصفح.'
                         when 'need_phone' then 'خطوة أخيرة: شارك رقم هاتفك بالزر أدناه ليتأكد المتجر منك (مرة واحدة فقط).'
                         when 'wrong' then 'الرقم غير صحيح، أُلغيت المحاولة. أعد الدخول من الموقع.'
                         else 'انتهت صلاحية المحاولة. أعد الدخول من الموقع.' end;
    return jsonb_strip_nulls(jsonb_build_object('method', 'sendMessage', 'chat_id', v_tg, 'text', v_text,
      'reply_markup', case when v_res = 'need_phone' then jsonb_build_object(
        'keyboard', jsonb_build_array(jsonb_build_array(jsonb_build_object('text', '📱 مشاركة رقمي', 'request_contact', true))),
        'resize_keyboard', true, 'one_time_keyboard', true) end));
  end if;

  if msg->'contact' is not null then
    v_res := public.reseller_login_phone(v_tg, (msg->'contact'->>'user_id')::bigint, msg->'contact'->>'phone_number');
    v_text := case v_res when 'ok' then 'تم ✅ ارجع الآن إلى المتصفح.'
                         when 'not_yours' then 'شارك رقمك أنت بالزر أسفل الشاشة، لا جهة اتصال أخرى.'
                         when 'bad_phone' then 'المنصة لأرقام العراق فقط.'
                         else 'انتهت صلاحية المحاولة. أعد الدخول من الموقع.' end;
    return jsonb_strip_nulls(jsonb_build_object('method', 'sendMessage', 'chat_id', v_tg, 'text', v_text,
      'reply_markup', case when v_res = 'ok' then jsonb_build_object('remove_keyboard', true) end));
  end if;

  v_nonce := substring(trim(coalesce(msg->>'text', '')) from '^/start login_([0-9a-f]{16})$');
  if v_nonce is null then
    return jsonb_build_object('method', 'sendMessage', 'chat_id', v_tg,
      'text', E'أهلاً 👋\nللدخول إلى منصة المتاجر: افتح الموقع واضغط «الدخول عبر تيليغرام».');
  end if;
  v_opts := public.reseller_login_claim(v_nonce, v_tg, v_name);
  if v_opts is null then
    return jsonb_build_object('method', 'sendMessage', 'chat_id', v_tg, 'text', 'انتهت صلاحية المحاولة. أعد الدخول من الموقع.');
  end if;
  return jsonb_build_object('method', 'sendMessage', 'chat_id', v_tg,
    'text', E'تسجيل الدخول إلى منصة المتاجر 🔐\nاضغط الرقم الظاهر على شاشة المتصفح.\nإن لم تكن أنت من طلب الدخول فتجاهل هذه الرسالة.',
    'reply_markup', jsonb_build_object('inline_keyboard', jsonb_build_array(
      (select jsonb_agg(jsonb_build_object('text', x::text, 'callback_data', 'lp:' || v_nonce || ':' || x) order by i)
         from unnest(v_opts) with ordinality t(x, i)))));
exception when others then
  raise warning 'reseller_bot_webhook: %', sqlerrm;      -- نردّ 200 فارغاً كي لا يعيد تيليغرام التحديث بلا نهاية
  return '{}'::jsonb;
end $$;

-- تسجيل الويبهوك من خوادم Supabase (تيليغرام غير متاح من بعض الشبكات). يستدعيه postgres وحده.
create or replace function public.reseller_bot_register(p_url text) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := public.reseller_secret('bot_token'); v_secret text := public.reseller_secret('webhook_secret');
begin
  if v_token is null or v_secret is null then raise exception 'أسرار البوت ناقصة'; end if;
  return net.http_post(url := 'https://api.telegram.org/bot' || v_token || '/setWebhook',
    body := jsonb_build_object('url', p_url, 'secret_token', v_secret, 'allowed_updates', jsonb_build_array('message', 'callback_query'), 'drop_pending_updates', true));
end $$;

-- ---------------------------------------------------------------------
-- الصلاحيات: كل دالة جديدة بقرار صريح
-- ---------------------------------------------------------------------
revoke all on function public.reseller_login_start(text), public.reseller_login_finish(text, text), public.reseller_login_seal(),
  public.reseller_bot_webhook(jsonb), public.reseller_bot_register(text) from public, anon, authenticated, service_role;
grant execute on function public.reseller_login_start(text), public.reseller_login_finish(text, text), public.reseller_bot_webhook(jsonb) to anon, authenticated;
grant execute on function public.reseller_login_seal() to authenticated;
