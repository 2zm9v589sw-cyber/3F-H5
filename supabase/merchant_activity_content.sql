alter table public.merchants
add column if not exists activity_content text not null default '';

update public.merchants
set activity_content = case
  when name = '卡雷拉' then '卡雷拉/机灵小将 60元（各10分钟）'
  when name = '爱就推门' then '30元（全场益智玩具体验不限时，不包含二次消费购买类产品）'
  when name = '童趣乐园' then '49元（不限时/次）'
  when name = '星梦湾' then '体验类、手工类、充值活动三选一立减10元'
  else activity_content
end
where name in ('卡雷拉', '爱就推门', '童趣乐园', '星梦湾');
