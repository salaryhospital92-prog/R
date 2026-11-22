-- زر «استدعاء كابتن» في إشعار البوت يعمل الآن بلا نشر البوت الجديد: يفتح شاشة «التجهيز»
-- في الموقع (تأكيد + استدعاء بضغطة). حين يُنشر البوت الجديد يُضبط bot_zad_buttons='on'
-- فيصير الزر داخل تيليغرام نفسه. القيم: off لا زر · link رابط التجهيز · on زر داخل البوت.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.notify_new_order'::regproc);
  n := replace(d, $a$select value = 'on' into v_zad$a$, $b$select value in ('on', 'link') into v_zad$b$);
  n := replace(n,
    $a$jsonb_build_object('text', '🚴 تأكيد واستدعاء كابتن', 'callback_data', 'zad:' || new.id)$a$,
    $b$case when (select value from public.app_settings where key = 'bot_zad_buttons') = 'link'
         then jsonb_build_object('text', '🚴 استدعاء كابتن', 'url', coalesce(v_site, '') || '/dashboard/dispatch')
         else jsonb_build_object('text', '🚴 تأكيد واستدعاء كابتن', 'callback_data', 'zad:' || new.id) end$b$);
  if n = d or n like '%select value = ''on'' into v_zad%' then
    raise exception 'لم ينطبق التعديل على notify_new_order';
  end if;
  execute n;
end $$;

update public.app_settings set value = 'link', updated_at = now() where key = 'bot_zad_buttons';
