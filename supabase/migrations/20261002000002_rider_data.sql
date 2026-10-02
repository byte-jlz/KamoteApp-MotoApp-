-- MotoMonitor accounts — 2 of 4: rider data that syncs from the phone. Safe to re-run.
--
-- Ids come from the app (short text, not UUIDs), so every key starts with user_id.
-- Sync columns on every table:
--   client_updated_at  when the rider changed it on their phone ("newest wins" between phones)
--   updated_at         when the server saved it (phones pull rows changed since their last pull)
--   deleted            soft delete, so other phones learn about deletions
-- Photos, videos, albums, profile photos and club logos stay on the phone (not stored here).

create table if not exists public.bikes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 64),
  name text not null default '' check (length(name) <= 100),
  make text not null default '' check (length(make) <= 100),
  model text not null default '' check (length(model) <= 100),
  year text check (length(year) <= 20),
  plate text check (length(plate) <= 30),
  type text not null check (length(type) <= 30),
  odometer numeric not null default 0,
  created_at timestamptz not null default now(),
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);

create table if not exists public.maint_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bike_id text not null check (length(bike_id) between 1 and 64),
  id text not null check (length(id) between 1 and 64),
  key text not null check (length(key) <= 50),
  name text not null check (length(name) <= 100),
  description text check (length(description) <= 1000),
  interval_km numeric,
  interval_months numeric,
  enabled boolean not null default false,
  dismissed boolean not null default false,
  last_km numeric not null default 0,
  last_date timestamptz not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, bike_id, id)
);

create table if not exists public.odometer_readings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bike_id text not null check (length(bike_id) between 1 and 64),
  read_at timestamptz not null,
  km numeric not null,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, bike_id, read_at)
);

create table if not exists public.service_logs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 64),
  bike_id text not null check (length(bike_id) between 1 and 64),
  date timestamptz not null,
  km numeric not null,
  item_ids text[] not null default '{}' check (cardinality(item_ids) <= 100),
  item_names text[] not null default '{}' check (cardinality(item_names) <= 100),
  cost numeric,
  shop text check (length(shop) <= 200),
  notes text check (length(notes) <= 2000),
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);

create table if not exists public.clubs (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (length(id) between 1 and 64),
  name text not null check (length(name) <= 100),
  role text check (length(role) <= 100),
  since text check (length(since) <= 20),
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (user_id, id)
);

create index if not exists bikes_pull_idx on public.bikes (user_id, updated_at);
create index if not exists maint_items_pull_idx on public.maint_items (user_id, updated_at);
create index if not exists odometer_readings_pull_idx on public.odometer_readings (user_id, updated_at);
create index if not exists service_logs_pull_idx on public.service_logs (user_id, updated_at);
create index if not exists service_logs_date_idx on public.service_logs (date);
create index if not exists clubs_pull_idx on public.clubs (user_id, updated_at);

-- "Newest wins": an edit made earlier on another phone never overwrites a newer one.
-- Also stamps updated_at, and caps phone clocks that run far ahead so a row can't be frozen.
create or replace function public.sync_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_updated_at > now() + interval '1 day' then
    new.client_updated_at := now();
  end if;
  if tg_op = 'UPDATE' and new.client_updated_at < old.client_updated_at then
    return null; -- keep the newer row
  end if;
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'bikes', 'maint_items', 'odometer_readings', 'service_logs', 'clubs'] loop
    execute format('drop trigger if exists sync_guard on public.%I', t);
    execute format(
      'create trigger sync_guard before insert or update on public.%I for each row execute function public.sync_guard()',
      t
    );
  end loop;
end;
$$;
