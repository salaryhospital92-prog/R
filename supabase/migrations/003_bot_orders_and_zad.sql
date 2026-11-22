-- البوت: (1) استدعاء كابتن زاد من تيليغرام  (2) إشعار الطلب لكل مدير فعّال مع أزرار.
--
-- (1) البوت يعمل بمفتاح الخدمة فلا auth.uid() له، فكانت zad_can ترفضه. zad_can مسحوبة
--     من كل الأدوار (تستدعيها دوال زاد فقط)، فلا يصل إليها مفتاح الخدمة إلا من الدالة
--     الحاملة له: لا أحد من المتصفح يستفيد من هذا الاستثناء. والبوت نفسه يتحقق
--     أن المرسل مدير مسجَّل قبل أن يستدعي.
-- (2) زر «استدعاء كابتن» في الإشعار مطفأ حتى يُنشر البوت الجديد (bot_zad_buttons='on')،
--     لئلا يظهر زر لا يعمل.
--
-- تنبيه للجلسة التي تملك mona-2-schema.sql: إعادة تطبيق notify_new_order منها
-- ستمحو الأزرار والمستلمين المتعددين — ادمج هذه النسخة فيها.

create or replace function public.zad_can(p_source text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(auth.role(), '') = 'service_role'
      or public.is_admin()
      or (p_source = 'mona' and coalesce(public.is_mona_admin(), false))
      or (p_source is distinct from 'mona' and coalesce(public.is_supervisor(), false));
end $$;
revoke all on function public.zad_can(text) from public, anon, authenticated;

grant execute on function public.zad_dispatch(uuid), public.zad_cancel(uuid) to service_role;

insert into public.app_settings (key, value, updated_at)
values ('bot_zad_buttons', 'off', now())
on conflict (key) do nothing;

create or replace function public.notify_new_order()
returns trigger language plpgsql security definer
set search_path = public, extensions as $fn$
declare
  v_token text; v_site text; v_text text; v_kb jsonb; v_zad boolean;
  v_chat text; v_line jsonb; v_items text := ''; v_qty text; v_i int := 0;
begin
  select value into v_token from public.app_settings where key = 'telegram_bot_token';
  select value into v_site  from public.app_settings where key = 'store_url';
  select value = 'on' into v_zad from public.app_settings where key = 'bot_zad_buttons';
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
    '🛒 طلب جديد #' || new.order_number || E'\n' ||
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
      jsonb_build_array(jsonb_build_object('text', '🚴 تأكيد واستدعاء كابتن', 'callback_data', 'zad:' || new.id)),
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
end $fn$;
