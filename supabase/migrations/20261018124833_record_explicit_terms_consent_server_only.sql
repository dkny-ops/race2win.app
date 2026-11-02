create table if not exists public.player_terms_acceptances (
 player_id uuid primary key references auth.users(id) on delete cascade,
 terms_version text not null,
 accepted_at timestamptz not null default now()
);
alter table public.player_terms_acceptances enable row level security;
revoke all on public.player_terms_acceptances from anon, authenticated;
grant select, insert, update on public.player_terms_acceptances to service_role;
create or replace function public.rtw_accept_current_terms(p_player_id uuid, p_version text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_player_id is null or p_version <> '2026-10-18' then raise exception 'Invalid terms acceptance'; end if;
 insert into public.player_terms_acceptances(player_id,terms_version,accepted_at)
 values(p_player_id,p_version,now())
 on conflict(player_id) do update set terms_version=excluded.terms_version,accepted_at=excluded.accepted_at;
end $$;
revoke all on function public.rtw_accept_current_terms(uuid,text) from public,anon,authenticated;
grant execute on function public.rtw_accept_current_terms(uuid,text) to service_role;;
