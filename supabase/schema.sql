create extension if not exists "pgcrypto";

create table if not exists public.activity_settings (
  id text primary key default 'main',
  activity_name text not null,
  benefit_text text not null,
  default_valid_days integer not null default 0,
  starts_on date,
  ends_on date,
  updated_at timestamptz not null default now()
);

create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  shop_code text not null,
  name text not null,
  activity_content text not null default '',
  category_key text not null default 'other',
  category_name text not null default '其他',
  is_guide_point boolean not null default false,
  can_issue boolean not null default true,
  can_redeem boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (shop_code, name)
);

create table if not exists public.coupon_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  redeem_scope text not null check (redeem_scope in ('guide_points', 'regular_merchants')),
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.threshold_rules (
  id uuid primary key default gen_random_uuid(),
  category_key text not null unique,
  category_name text not null,
  min_amount numeric(12,2) not null default 0,
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  coupon_type_id uuid not null references public.coupon_types(id),
  coupon_type_code text not null,
  coupon_type_name text not null,
  source_merchant_id uuid references public.merchants(id) on delete set null,
  source_label text not null,
  benefit_text text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'unused' check (status in ('unused', 'used', 'expired')),
  issued_amount numeric(12,2),
  issued_category_key text,
  issued_at timestamptz not null default now(),
  redeemed_at text,
  redeem_merchant_id uuid references public.merchants(id) on delete set null,
  redeem_point_label text,
  redeem_amount numeric(12,2),
  phone_last4 text,
  note text
);

create index if not exists coupons_code_idx on public.coupons(code);
create index if not exists coupons_status_idx on public.coupons(status);
create index if not exists coupons_issued_at_idx on public.coupons(issued_at desc);

alter table public.activity_settings enable row level security;
alter table public.merchants enable row level security;
alter table public.coupon_types enable row level security;
alter table public.threshold_rules enable row level security;
alter table public.coupons enable row level security;

insert into public.activity_settings (id, activity_name, benefit_text, default_valid_days, starts_on, ends_on)
values ('main', '西宁城北吾悦广场暑期3楼特别活动', '当天有效，逾期自动作废；核销以后台券码状态为准。', 0, '2026-07-01', '2026-08-31')
on conflict (id) do update set
  activity_name = excluded.activity_name,
  benefit_text = excluded.benefit_text,
  default_valid_days = excluded.default_valid_days,
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on;

insert into public.coupon_types (code, name, redeem_scope, active, sort_order) values
('guide', '亲子畅玩引导卡', 'guide_points', true, 1),
('repurchase', '品牌复购引导券', 'regular_merchants', true, 2)
on conflict (code) do update set name = excluded.name, redeem_scope = excluded.redeem_scope, active = excluded.active, sort_order = excluded.sort_order;

insert into public.threshold_rules (category_key, category_name, min_amount, active, sort_order) values
('retail_kids', '儿童零售', 299, true, 1),
('sports_outdoor', '运动户外', 599, true, 2),
('experience', '体验类', 199, true, 3)
on conflict (category_key) do update set category_name = excluded.category_name, min_amount = excluded.min_amount, active = excluded.active, sort_order = excluded.sort_order;

insert into public.merchants (shop_code, name, category_key, category_name, is_guide_point, can_issue, can_redeem, active, sort_order) values
('Z305', '骆驼', 'sports_outdoor', '运动户外', false, true, true, true, 1),
('Z303', '天空之城', 'experience', '体验类', false, true, true, true, 2),
('Z301', '格瑞丽家', 'retail_kids', '儿童零售', false, true, true, true, 3),
('Z302', '好奇乐', 'retail_kids', '儿童零售', false, true, true, true, 4),
('3033', '361°童装', 'retail_kids', '儿童零售', false, true, true, true, 5),
('3021,3022', '361°', 'sports_outdoor', '运动户外', false, true, true, true, 6),
('3006', 'DR.KONG', 'retail_kids', '儿童零售', false, true, true, true, 7),
('3027', 'Kappa', 'sports_outdoor', '运动户外', false, true, true, true, 8),
('3005', 'MOMOCO', 'retail_kids', '儿童零售', false, true, true, true, 9),
('3026', 'SKECHERS', 'sports_outdoor', '运动户外', false, true, true, true, 10),
('3017', '回力', 'sports_outdoor', '运动户外', false, true, true, true, 11),
('3030,3031', 'anta kids', 'retail_kids', '儿童零售', false, true, true, true, 12),
('3037,3038', 'Balabala', 'retail_kids', '儿童零售', false, true, true, true, 13),
('3028,3029', '李宁', 'sports_outdoor', '运动户外', false, true, true, true, 14),
('3013-3015', '特步', 'sports_outdoor', '运动户外', false, true, true, true, 15),
('3009', 'NIKE', 'sports_outdoor', '运动户外', false, true, true, true, 16),
('3001', '光明园迪', 'retail_kids', '儿童零售', false, true, true, true, 17),
('3023', '探路者', 'sports_outdoor', '运动户外', false, true, true, true, 18),
('3036', '童泰', 'retail_kids', '儿童零售', false, true, true, true, 19),
('3035', '星空棒棒糖', 'retail_kids', '儿童零售', false, true, true, true, 20),
('3011', '安踏', 'sports_outdoor', '运动户外', false, true, true, true, 21),
('3016', '保罗彼得', 'retail_kids', '儿童零售', false, true, true, true, 22),
('3010', 'NDU恩度', 'retail_kids', '儿童零售', false, true, true, true, 23),
('3008', 'JEEP SPIRIT', 'sports_outdoor', '运动户外', false, true, true, true, 24),
('3002', '手乐岛', 'retail_kids', '儿童零售', false, true, true, true, 25),
('3020-1', '第九星球', 'experience', '体验类', false, true, true, true, 26),
('3032', '妙妙糖果', 'retail_kids', '儿童零售', false, true, true, true, 27),
('3020-2', '大涛配镜品牌集合店', 'retail_kids', '儿童零售', false, true, true, true, 28),
('3007', '淘米粒', 'retail_kids', '儿童零售', false, true, true, true, 29),
('3025', 'Puhn Arigcls', 'retail_kids', '儿童零售', false, true, true, true, 30),
('3040', '酷卡卡丁', 'experience', '体验类', false, true, true, true, 31),
('3003', '菠萝树', 'retail_kids', '儿童零售', false, true, true, true, 32),
('3019-1,3019-2-2', '光痕电竞', 'experience', '体验类', false, true, true, true, 33),
('3012', '乔丹', 'sports_outdoor', '运动户外', false, true, true, true, 34),
('3039', '史莱姆主题乐园', 'experience', '体验类', false, true, true, true, 35),
('3019-2-1', '友味奶博士', 'retail_kids', '儿童零售', false, true, true, true, 36),
('301', '科大讯飞', 'retail_kids', '儿童零售', false, true, true, true, 37),
('306', '啦芙莱', 'retail_kids', '儿童零售', false, true, true, true, 38),
('304', '爱就推门', 'experience', '体验类', true, true, true, true, 39),
('913', '多种经营', 'experience', '体验类', true, false, true, true, 40),
('310', '童趣乐园', 'experience', '体验类', true, true, true, true, 41),
('302', '小天才', 'retail_kids', '儿童零售', false, true, true, true, 42),
('312', '作业帮', 'retail_kids', '儿童零售', false, true, true, true, 43),
('305', '学而思', 'retail_kids', '儿童零售', false, true, true, true, 44),
('307', '悦行童玩', 'retail_kids', '儿童零售', false, true, true, true, 45),
('309', '趣味鱼', 'experience', '体验类', true, true, true, true, 46),
('308,GDSN-3F-023', '星梦湾', 'experience', '体验类', true, true, true, true, 47),
('GDSN-3F-022', '趣兜兜乐园', 'experience', '体验类', true, true, true, true, 48),
('311', '卡雷拉', 'experience', '体验类', true, true, true, true, 49)
on conflict (shop_code, name) do update set
  category_key = excluded.category_key,
  category_name = excluded.category_name,
  is_guide_point = excluded.is_guide_point,
  can_issue = excluded.can_issue,
  can_redeem = excluded.can_redeem,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

update public.merchants
set activity_content = case
  when name = '卡雷拉' then '卡雷拉/机灵小将 60元（各10分钟）'
  when name = '爱就推门' then '30元（全场益智玩具体验不限时，不包含二次消费购买类产品）'
  when name = '童趣乐园' then '49元（不限时/次）'
  when name = '星梦湾' then '体验类、手工类、充值活动三选一立减10元'
  else activity_content
end
where name in ('卡雷拉', '爱就推门', '童趣乐园', '星梦湾');
