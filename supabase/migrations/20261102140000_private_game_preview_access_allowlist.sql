create table if not exists public.game_preview_access (
 game_slug text not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 label text not null,
 created_at timestamptz not null default now(),
 primary key (game_slug,user_id)
);
alter table public.game_preview_access enable row level security;
revoke all on public.game_preview_access from public,anon,authenticated;
grant select on public.game_preview_access to service_role;
insert into public.game_preview_access(game_slug,user_id,label)
select 'jumping-race',p.user_id,p.username from public.profiles p
where lower(p.username) in ('laly','badboy','test1')
on conflict(game_slug,user_id) do nothing;
