revoke execute on function public.public_get_coupon(text) from public, anon, authenticated;
revoke execute on function public.public_issue_coupon(text, uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.public_redeem_coupon(text, uuid, numeric, text, text) from public, anon, authenticated;

grant execute on function public.public_get_coupon(text) to service_role;
grant execute on function public.public_issue_coupon(text, uuid, text, numeric) to service_role;
grant execute on function public.public_redeem_coupon(text, uuid, numeric, text, text) to service_role;
