-- أوقات العمل 9:00 ← 17:45 بتوقيت بغداد (نفس حدود orderWindow في src/lib/store.js).
-- الطلب خارجها يُقبل ويصل لكل مديري البوت كالمعتاد، لكن الإشعار يبدأ بسطر «⏰ خارج أوقات العمل»
-- ليعرف الموظف أنه يُجهَّز عند الافتتاح. لا شيء يمنع الاستدعاء: zad_dispatch بلا قيد ساعات،
-- فالموظف يستدعي كابتناً في أي وقت.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.notify_new_order'::regproc);
  n := replace(d,
    $a$'🛒 طلب جديد #' || new.order_number$a$,
    $b$case when (now() at time zone 'Asia/Baghdad')::time between time '09:00' and time '17:45:59' then ''
         else '⏰ خارج أوقات العمل — يُجهَّز ' ||
              case when (now() at time zone 'Asia/Baghdad')::time < time '09:00' then 'اليوم' else 'غداً' end ||
              E' الساعة 9:00 صباحاً\n' end
    || '🛒 طلب جديد #' || new.order_number$b$);
  if n = d then raise exception 'لم ينطبق التعديل على notify_new_order'; end if;
  execute n;
end $$;
