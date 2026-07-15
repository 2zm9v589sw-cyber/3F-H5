create table if not exists public.receipt_fingerprints (
  id uuid primary key default gen_random_uuid(),
  coupon_code text not null references public.coupons(code) on delete cascade,
  receipt_kind text not null check (receipt_kind in ('issue', 'redeem')),
  content_hash text not null unique,
  perceptual_hash text not null,
  hash_seg0 text not null,
  hash_seg1 text not null,
  hash_seg2 text not null,
  hash_seg3 text not null,
  hash_seg4 text not null,
  hash_seg5 text not null,
  hash_seg6 text not null,
  hash_seg7 text not null,
  storage_path text not null unique,
  merchant_id uuid references public.merchants(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (coupon_code, receipt_kind)
);

create index if not exists receipt_fingerprints_coupon_idx on public.receipt_fingerprints(coupon_code);
create index if not exists receipt_fingerprints_seg0_idx on public.receipt_fingerprints(hash_seg0);
create index if not exists receipt_fingerprints_seg1_idx on public.receipt_fingerprints(hash_seg1);
create index if not exists receipt_fingerprints_seg2_idx on public.receipt_fingerprints(hash_seg2);
create index if not exists receipt_fingerprints_seg3_idx on public.receipt_fingerprints(hash_seg3);
create index if not exists receipt_fingerprints_seg4_idx on public.receipt_fingerprints(hash_seg4);
create index if not exists receipt_fingerprints_seg5_idx on public.receipt_fingerprints(hash_seg5);
create index if not exists receipt_fingerprints_seg6_idx on public.receipt_fingerprints(hash_seg6);
create index if not exists receipt_fingerprints_seg7_idx on public.receipt_fingerprints(hash_seg7);

create table if not exists public.coupon_archive_batches (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  coupon_count integer not null default 0,
  receipt_count integer not null default 0,
  created_at timestamptz not null default now(),
  restored_at timestamptz,
  note text
);

create table if not exists public.coupon_archives (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.coupon_archive_batches(id) on delete cascade,
  coupon_code text not null,
  coupon_data jsonb not null,
  created_at timestamptz not null default now(),
  unique (batch_id, coupon_code)
);

create index if not exists coupon_archives_batch_idx on public.coupon_archives(batch_id);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  target text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs(created_at desc);

alter table public.receipt_fingerprints enable row level security;
alter table public.coupon_archive_batches enable row level security;
alter table public.coupon_archives enable row level security;
alter table public.admin_audit_logs enable row level security;

revoke all on table public.receipt_fingerprints from public, anon, authenticated;
revoke all on table public.coupon_archive_batches from public, anon, authenticated;
revoke all on table public.coupon_archives from public, anon, authenticated;
revoke all on table public.admin_audit_logs from public, anon, authenticated;

grant all on table public.receipt_fingerprints to service_role;
grant all on table public.coupon_archive_batches to service_role;
grant all on table public.coupon_archives to service_role;
grant all on table public.admin_audit_logs to service_role;

create or replace function public.admin_coupon_metrics()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.coupons),
    'used', (select count(*) from public.coupons where status = 'used'),
    'unused', (select count(*) from public.coupons where status = 'unused' and end_date >= current_date),
    'expired', (select count(*) from public.coupons where status = 'expired' or (status = 'unused' and end_date < current_date)),
    'issueReceipts', (select count(*) from public.receipt_fingerprints where receipt_kind = 'issue'),
    'redeemReceipts', (select count(*) from public.receipt_fingerprints where receipt_kind = 'redeem')
  );
$$;

revoke execute on function public.admin_coupon_metrics() from public, anon, authenticated;
grant execute on function public.admin_coupon_metrics() to service_role;
