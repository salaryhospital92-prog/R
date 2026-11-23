-- =====================================================================
-- 020 — التقارير والإشعار: ربح المروّج ليس مبيعات رفاعي (مسودة)
-- =====================================================================
-- التقارير الثلاثة تقرأ rifai_orders_net() بدل جدول الطلبات: نفس الصفوف،
-- وطلب المروّج فيها بسعر الأساس. غير طلبات المروّج يمرّ كما هو حرفياً.
-- التعديل على التعريف الحيّ نصّاً، ويتوقف إن لم يجد ما يتوقعه.
-- =====================================================================
set local lock_timeout = '5s';

-- security invoker عمداً: صلاحيات القارئ على orders تبقى سارية
create or replace function public.rifai_orders_net() returns setof public.orders
language sql stable set search_path = public as $$
  select * from public.orders where source <> 'reseller'
  union all
  select n.* from public.orders o
  left join public.reseller_orders ro on ro.order_id = o.id
  cross join lateral jsonb_populate_record(o, jsonb_build_object(
    'subtotal',     coalesce(ro.base_subtotal, o.subtotal),
    'total_amount', o.total_amount - coalesce(ro.profit, 0),
    'items_json',   coalesce((select jsonb_agg(it.v || jsonb_build_object('line_total', i.base_total) order by it.n)
                       from jsonb_array_elements(o.items_json) with ordinality it(v, n)
                       join public.reseller_order_items i on i.order_id = o.id and i.line_no = it.n), o.items_json))) n
   where o.source = 'reseller'
$$;
-- التقارير تعمل بصلاحية المستدعي فيلزمه تنفيذها؛ RLS على orders هي الحماية
revoke all on function public.rifai_orders_net() from public, anon;
grant execute on function public.rifai_orders_net() to authenticated, service_role;

do $$
declare f text; d text; n text;
begin
  foreach f in array array['public.finance_summary(date,date)', 'public.top_products(date,date,integer)', 'public.send_daily_sales_report()'] loop
    d := pg_get_functiondef(f::regprocedure);
    if d like '%rifai_orders_net%' then continue; end if;
    n := regexp_replace(d, 'from public\.orders\M', 'from public.rifai_orders_net()', 'g');
    if n = d or n ~ 'public\.orders\M' then raise exception 'لم ينطبق التعديل: %', f; end if;
    execute n;
  end loop;

  -- إشعار الطلب: اسم المتجر في العنوان
  d := pg_get_functiondef('public.notify_new_order'::regproc);
  if d not like '%طلب متجر%' then
    n := replace(d, $a$case when new.source = 'mona' then '🌸 طلب المنى #' else$a$,
      $b$case when new.source = 'mona' then '🌸 طلب المنى #'
             when new.source = 'reseller' then '🏬 طلب متجر «' || (select s.name from public.reseller_stores s where s.id = new.reseller_store_id) || '» #' else$b$);
    if n = d then raise exception 'لم ينطبق التعديل: notify_new_order'; end if;
    execute n;
  end if;
end $$;
