create or replace function public.rtw_owner_confirm_full_balance_paid(p_actor uuid,p_player uuid,p_winner uuid)
returns bigint language plpgsql security definer set search_path='' as $$
begin
 raise exception 'Final payment settlement disabled pending authorization and security review' using errcode='42501';
end $$;
revoke all on function public.rtw_owner_confirm_full_balance_paid(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.rtw_owner_confirm_full_balance_paid(uuid,uuid,uuid) to service_role;;
