-- وصف المنتج: يُملأ تلقائياً بالنص المقروء من صورته (OCR في المتصفح) ويدخل في البحث.
alter table public.products add column if not exists description text;

-- العمود يُضاف في آخر العرض (create or replace لا يقبل غير ذلك). الخيارات والصلاحيات تبقى كما هي.
do $$
declare d text;
begin
  d := pg_get_viewdef('public.storefront_products'::regclass, true);
  d := regexp_replace(d, ';\s*$', '');
  if d like '%p.description%' then return; end if;
  d := replace(d, E'pr.price_wholesale\n', E'pr.price_wholesale,\n    p.description\n');
  if d not like '%p.description%' then raise exception 'لم ينطبق التعديل على storefront_products'; end if;
  execute 'create or replace view public.storefront_products as ' || d;
end $$;
