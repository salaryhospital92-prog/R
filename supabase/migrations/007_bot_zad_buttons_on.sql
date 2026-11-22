-- البوت الجديد نُشر (Edge Function telegram): زر «استدعاء كابتن» صار داخل تيليغرام نفسه
-- (شاشة تأكيد ثم استدعاء). للرجوع إلى فتح صفحة التجهيز: update ... set value='link'.
update public.app_settings set value = 'on', updated_at = now() where key = 'bot_zad_buttons';
