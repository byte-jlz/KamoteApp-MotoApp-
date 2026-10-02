-- MotoMonitor accounts — 1 of 4: profiles (one row per login account).
-- Run in Supabase → SQL Editor → New query → Run. Safe to re-run.
-- Does not touch the fuel tables, devices or register_device().

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'rider' check (role in ('rider', 'admin')),
  -- Optional login name. Stored lowercase; the app lowercases what the rider types.
  username text unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  full_name text not null default '' check (length(full_name) <= 100),
  settings jsonb not null default '{}'::jsonb check (length(settings::text) <= 2000),
  privacy_consent_at timestamptz,
  privacy_version text check (length(privacy_version) <= 20),
  -- Set by Edge Functions only (riders have no UPDATE right on these columns).
  must_change_password boolean not null default false,
  temp_password_expires_at timestamptz,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- When the rider last edited name/settings on their phone. Used for "newest wins" sync.
  client_updated_at timestamptz not null default 'epoch'
);

-- Every new auth user gets a profile. Role and flags are NEVER read from what the client sends:
-- only username, full name and the privacy notice version they agreed to at sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, username, full_name, privacy_consent_at, privacy_version)
  values (
    new.id,
    lower(nullif(trim(meta ->> 'username'), '')),
    left(coalesce(trim(meta ->> 'full_name'), ''), 100),
    case when meta ? 'privacy_version' then now() end,
    left(meta ->> 'privacy_version', 20)
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts that already exist (e.g. the test invitation) get a profile too.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
