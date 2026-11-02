create or replace function private.rtw_human_check_finalize_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare v_status text; v_due timestamptz;
begin
 if old.status='active' and new.status='finalized' and new.final_elapsed_ms >= 90000 then
   select status,due_at into v_status,v_due from private.rtw_human_checks where session_id=new.id and player_id=new.user_id;
   if found and v_due <= new.started_at + make_interval(secs=>new.final_elapsed_ms / 1000.0) and v_status <> 'verified' then
     new.anti_fraud_status := 'under_review';
   end if;
 end if;
 return new;
end $$;;
