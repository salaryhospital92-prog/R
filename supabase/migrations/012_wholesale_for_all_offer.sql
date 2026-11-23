-- عرض مؤقت: من يشتري من المتجر مباشرة (مفرد أو جملة) يدفع سعر الجملة للقطعة.
-- لا يمسّ product_prices إطلاقاً: الإطفاء يعيد الأسعار كما كانت:
--   update public.app_settings set value = 'off' where key = 'promo_wholesale_all';
-- ثم أعد بناء الموقع (صفحات المنتجات المولَّدة تحمل السعر وقت البناء).
-- ما ليس له سعر جملة يأخذ المفرد، وما ليس له مفرد يأخذ الجملة.
-- المستثنى (يبقى كما هو حتى يُصحَّح): جملة أعلى من المفرد، أو مفرد ≥ ضعف الجملة
-- (خطأ إدخال: سعر القطعة كُتب في خانة الدرزن، مثل عطر بـ9 دنانير).
create or replace function public.rifai_price(p_wholesale bigint, p_retail bigint, p_mode text, p_promo boolean)
returns bigint language sql immutable as $$
  select case
    when not coalesce(p_promo, false) or (p_wholesale > 0 and p_retail > 0
         and (p_wholesale > p_retail or p_retail >= 2 * p_wholesale))
      then case when p_mode = 'wholesale' then p_wholesale else p_retail end
    when p_wholesale > 0 then p_wholesale
    else p_retail
  end
$$;
-- العرض يستدعيها بصلاحية الزائر؛ حساب صرف لا يقرأ جدولاً
grant execute on function public.rifai_price(bigint, bigint, text, boolean) to anon, authenticated, service_role;

insert into public.app_settings (key, value) values ('promo_wholesale_all', 'on')
on conflict (key) do update set value = 'on', updated_at = now();

do $$
declare d text; n text; bad int;
begin
  -- 1) العرض العام
  d := regexp_replace(pg_get_viewdef('public.storefront_products'::regclass, true), ';\s*$', '');
  n := regexp_replace(d, 'pr\.price_retail,\s+pr\.price_wholesale,',
    $r$public.rifai_price(pr.price_wholesale, pr.price_retail, 'retail', (select s.value = 'on' from public.app_settings s where s.key = 'promo_wholesale_all')) as price_retail,
    public.rifai_price(pr.price_wholesale, pr.price_retail, 'wholesale', (select s.value = 'on' from public.app_settings s where s.key = 'promo_wholesale_all')) as price_wholesale,$r$);
  if n = d then raise exception 'لم ينطبق التعديل على storefront_products'; end if;
  execute 'create or replace view public.storefront_products as ' || n;

  -- 2) الطلب: نفس الدالة، فلا يختلف ما يُعرض عمّا يُحاسَب
  d := pg_get_functiondef('public.create_order'::regproc);
  n := replace(d, $a$case when p_mode = 'wholesale' then pr.price_wholesale else pr.price_retail end,$a$,
    $b$public.rifai_price(pr.price_wholesale, pr.price_retail, p_mode,
             (select s.value = 'on' from public.app_settings s where s.key = 'promo_wholesale_all')),$b$);
  if n = d then raise exception 'لم ينطبق التعديل على create_order'; end if;
  execute n;

  -- 3) فحص: لا سعر ينزل إلى أقل من نصف المفرد بسبب العرض، ولا مشبوه تغيّر
  select count(*) into bad
    from public.storefront_products v join public.product_prices pr on pr.product_id = v.id
   where (pr.price_retail > 0 and v.price_retail * 2 < pr.price_retail)
      or (pr.price_wholesale > 0 and pr.price_retail > 0
          and (pr.price_wholesale > pr.price_retail or pr.price_retail >= 2 * pr.price_wholesale)
          and (v.price_retail <> pr.price_retail or v.price_wholesale <> pr.price_wholesale));
  if bad > 0 then raise exception 'العرض أنتج % سعراً غير آمن', bad; end if;
end $$;
