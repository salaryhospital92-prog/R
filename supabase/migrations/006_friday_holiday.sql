-- الجمعة إجازة: كل طلب فيها يؤجَّل إلى السبت، وطلب الخميس بعد 17:45 كذلك.
-- نفس منطق orderWindow في src/lib/store.js. (extract dow: الجمعة=5، الخميس=4)
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.notify_new_order'::regproc);
  n := replace(d,
    $a$case when (now() at time zone 'Asia/Baghdad')::time between$a$,
    $b$case when extract(dow from now() at time zone 'Asia/Baghdad') = 5
              then '⏰ إجازة الجمعة — يُجهَّز يوم السبت الساعة 9:00 صباحاً' || E'\n'
         when (now() at time zone 'Asia/Baghdad')::time between$b$);
  if n = d then raise exception 'لم ينطبق التعديل الأول'; end if;
  d := n;
  n := replace(d,
    $a$case when (now() at time zone 'Asia/Baghdad')::time < time '09:00' then 'اليوم' else 'غداً' end$a$,
    $b$case when (now() at time zone 'Asia/Baghdad')::time < time '09:00' then 'اليوم'
              when extract(dow from now() at time zone 'Asia/Baghdad') = 4 then 'يوم السبت'
              else 'غداً' end$b$);
  if n = d then raise exception 'لم ينطبق التعديل الثاني'; end if;
  execute n;
end $$;
