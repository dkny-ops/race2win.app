create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text,
  paypal_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (
    username is null or username ~ '^[A-Za-z0-9_]{3,20}$'
  ),
  constraint profiles_paypal_email_format check (
    paypal_email is null or paypal_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);

-- The expression index makes usernames unique regardless of case without storing a duplicate value.
create unique index profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant insert (user_id, username, paypal_email) on table public.profiles to authenticated;
grant update (username, paypal_email) on table public.profiles to authenticated;

create policy "Profiles are readable by their owner"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Profiles are insertable by their owner"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Profiles are updatable by their owner"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create function private.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function private.prevent_profile_username_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.username is not null and new.username is distinct from old.username then
    raise exception 'Username cannot be changed once set.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.set_profile_updated_at() from public, anon, authenticated;
revoke all on function private.prevent_profile_username_change() from public, anon, authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_profile_updated_at();

create trigger profiles_prevent_username_change
  before update on public.profiles
  for each row execute function private.prevent_profile_username_change();
