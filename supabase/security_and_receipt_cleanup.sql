create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

revoke execute on function public.public_get_coupon(text) from public, anon, authenticated;
revoke execute on function public.public_issue_coupon(text, uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.public_redeem_coupon(text, uuid, numeric, text, text) from public, anon, authenticated;

grant execute on function public.public_get_coupon(text) to service_role;
grant execute on function public.public_issue_coupon(text, uuid, text, numeric) to service_role;
grant execute on function public.public_redeem_coupon(text, uuid, numeric, text, text) to service_role;

-- Replace the placeholder before running this file in Supabase SQL Editor.
delete from vault.secrets where name = 'receipt_cleanup_key';
select vault.create_secret('REPLACE_WITH_CLEANUP_KEY', 'receipt_cleanup_key', 'Xining 3F receipt cleanup job');

select cron.unschedule(jobid)
from cron.job
where jobname = 'receipt-cleanup-daily';

select cron.schedule(
  'receipt-cleanup-daily',
  '15 3 * * *',
  $job$
  select net.http_post(
    url := 'https://xncbwu3f.com/api/receipt-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cleanup-Key', (select decrypted_secret from vault.decrypted_secrets where name = 'receipt_cleanup_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $job$
);
