alter table public.activity_settings add column if not exists admin_password_hash text;

drop policy if exists "public read activity settings" on public.activity_settings;
drop policy if exists "public read merchants" on public.merchants;
drop policy if exists "public read coupon types" on public.coupon_types;
drop policy if exists "public read threshold rules" on public.threshold_rules;

create policy "public read activity settings"
on public.activity_settings for select
to anon, authenticated
using (id = 'main');

create policy "public read merchants"
on public.merchants for select
to anon, authenticated
using (active = true);

create policy "public read coupon types"
on public.coupon_types for select
to anon, authenticated
using (active = true);

create policy "public read threshold rules"
on public.threshold_rules for select
to anon, authenticated
using (active = true);

create or replace function public.public_get_coupon(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon coupons%rowtype;
  v_status text;
begin
  select * into v_coupon
  from public.coupons
  where code = upper(trim(p_code))
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'message', '未找到该券码。');
  end if;

  v_status := case
    when v_coupon.status = 'used' then 'used'
    when current_date > v_coupon.end_date then 'expired'
    else 'unused'
  end;

  return jsonb_build_object('ok', true, 'coupon', to_jsonb(v_coupon) || jsonb_build_object('computedStatus', v_status));
end;
$$;

create or replace function public.public_issue_coupon(
  p_coupon_type_code text,
  p_source_merchant_id uuid,
  p_category_key text,
  p_order_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_setting activity_settings%rowtype;
  v_merchant merchants%rowtype;
  v_type coupon_types%rowtype;
  v_threshold threshold_rules%rowtype;
  v_start date;
  v_end date;
  v_code text;
  v_coupon coupons%rowtype;
  i integer := 0;
begin
  select * into v_setting from public.activity_settings where id = 'main';
  select * into v_merchant from public.merchants where id = p_source_merchant_id and active = true;
  select * into v_type from public.coupon_types where code = p_coupon_type_code and active = true;
  select * into v_threshold from public.threshold_rules where category_key = p_category_key and active = true;

  if v_threshold.id is null then
    return jsonb_build_object('ok', false, 'message', '消费类别未配置赠券门槛。');
  end if;
  if v_setting.id is null then
    return jsonb_build_object('ok', false, 'message', '活动基础配置缺失。');
  end if;
  if v_merchant.id is null or v_merchant.can_issue is not true then
    return jsonb_build_object('ok', false, 'message', '该商户未启用发券权限。');
  end if;
  if v_type.id is null then
    return jsonb_build_object('ok', false, 'message', '券类型不可用。');
  end if;
  if coalesce(p_order_amount, 0) < v_threshold.min_amount then
    return jsonb_build_object('ok', false, 'message', v_threshold.category_name || '需消费满' || v_threshold.min_amount || '元方可赠券。');
  end if;

  v_start := current_date;
  v_end := current_date + greatest(0, coalesce(v_setting.default_valid_days, 0));

  loop
    i := i + 1;
    v_code := upper(left(v_type.code, 3)) || '-' || to_char(current_date, 'MMDD') || '-' || lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from public.coupons where code = v_code) or i > 20;
  end loop;

  insert into public.coupons (
    code, coupon_type_id, coupon_type_code, coupon_type_name,
    source_merchant_id, source_label, benefit_text,
    start_date, end_date, status, issued_amount, issued_category_key
  )
  values (
    v_code, v_type.id, v_type.code, v_type.name,
    v_merchant.id, v_merchant.shop_code || '｜' || v_merchant.name, v_setting.benefit_text,
    v_start, v_end, 'unused', p_order_amount, p_category_key
  )
  returning * into v_coupon;

  return jsonb_build_object('ok', true, 'coupon', to_jsonb(v_coupon) || jsonb_build_object('computedStatus', 'unused'));
end;
$$;

create or replace function public.public_redeem_coupon(
  p_code text,
  p_redeem_merchant_id uuid,
  p_redeem_amount numeric,
  p_phone_last4 text default '',
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon coupons%rowtype;
  v_merchant merchants%rowtype;
  v_type coupon_types%rowtype;
begin
  select * into v_coupon from public.coupons where code = upper(trim(p_code)) limit 1;
  select * into v_merchant from public.merchants where id = p_redeem_merchant_id and active = true limit 1;

  if v_coupon.id is null then
    return jsonb_build_object('ok', false, 'message', '未找到该券码，不能核销。');
  end if;
  if v_merchant.id is null or v_merchant.can_redeem is not true then
    return jsonb_build_object('ok', false, 'message', '该点位未启用核销权限。');
  end if;
  if v_coupon.status = 'used' or current_date > v_coupon.end_date then
    return jsonb_build_object('ok', false, 'message', '该券已使用或已过期，不能核销。', 'coupon', to_jsonb(v_coupon));
  end if;

  select * into v_type from public.coupon_types where id = v_coupon.coupon_type_id limit 1;
  if v_type.redeem_scope = 'guide_points' and v_merchant.is_guide_point is not true then
    return jsonb_build_object('ok', false, 'message', '亲子畅玩引导卡只能在已配置的亲子多经点位核销。');
  end if;
  if v_type.redeem_scope = 'regular_merchants' and v_merchant.is_guide_point is true then
    return jsonb_build_object('ok', false, 'message', '品牌复购引导券不能在亲子多经点位核销，请选择正铺或主次力店。');
  end if;

  update public.coupons
  set status = 'used',
      redeem_merchant_id = v_merchant.id,
      redeem_point_label = v_merchant.shop_code || '｜' || v_merchant.name,
      redeem_amount = coalesce(p_redeem_amount, 0),
      phone_last4 = coalesce(p_phone_last4, ''),
      note = coalesce(p_note, ''),
      redeemed_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  where id = v_coupon.id and status = 'unused'
  returning * into v_coupon;

  if v_coupon.id is null then
    return jsonb_build_object('ok', false, 'message', '该券状态已变化，请刷新后重试。');
  end if;

  return jsonb_build_object('ok', true, 'coupon', to_jsonb(v_coupon) || jsonb_build_object('computedStatus', 'used'));
end;
$$;

revoke execute on function public.public_get_coupon(text) from anon, authenticated;
revoke execute on function public.public_issue_coupon(text, uuid, text, numeric) from anon, authenticated;
revoke execute on function public.public_redeem_coupon(text, uuid, numeric, text, text) from anon, authenticated;
grant execute on function public.public_get_coupon(text) to service_role;
grant execute on function public.public_issue_coupon(text, uuid, text, numeric) to service_role;
grant execute on function public.public_redeem_coupon(text, uuid, numeric, text, text) to service_role;
