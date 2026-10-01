-- MotoMonitor fuel price alerts — run this once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run.

-- Detected price adjustments: one row per fuel type per effective date (PH adjustments take effect on Tuesdays).
create table if not exists public.fuel_adjustments (
  id bigint generated always as identity primary key,
  effective_date date not null,
  fuel_type text not null check (fuel_type in ('gasoline', 'diesel', 'kerosene')),
  direction text not null check (direction in ('up', 'down', 'none')),
  amount_min numeric(6, 2) not null check (amount_min >= 0),
  amount_max numeric(6, 2) not null check (amount_max >= amount_min),
  headline text not null,
  source_url text,
  source_name text,
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (effective_date, fuel_type)
);

-- News headlines shown in the app (title + link only).
create table if not exists public.fuel_headlines (
  id bigint generated always as identity primary key,
  title text not null,
  url text not null unique,
  source_name text,
  published_at timestamptz,
  direction text check (direction in ('up', 'down', 'none')),
  created_at timestamptz not null default now()
);

-- Phones that receive pushes. Not readable by the app; written only through register_device().
create table if not exists public.devices (
  token text primary key,
  platform text not null,
  fuel_alerts boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

alter table public.fuel_adjustments enable row level security;
alter table public.fuel_headlines enable row level security;
alter table public.devices enable row level security;

-- The app (anon key) may only READ fuel data. The scraper uses the service_role key, which bypasses RLS.
drop policy if exists "Anyone can read fuel adjustments" on public.fuel_adjustments;
create policy "Anyone can read fuel adjustments" on public.fuel_adjustments
  for select to anon, authenticated using (true);

drop policy if exists "Anyone can read fuel headlines" on public.fuel_headlines;
create policy "Anyone can read fuel headlines" on public.fuel_headlines
  for select to anon, authenticated using (true);

-- No policies on devices: the anon key can't list or read anyone's tokens.

-- The only way the app can touch devices: register/update its own token.
create or replace function public.register_device(p_token text, p_platform text, p_fuel_alerts boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 512 then
    raise exception 'invalid token';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'invalid platform';
  end if;
  insert into devices (token, platform, fuel_alerts)
  values (p_token, p_platform, coalesce(p_fuel_alerts, true))
  on conflict (token) do update
    set platform = excluded.platform,
        fuel_alerts = excluded.fuel_alerts,
        last_seen = now();
end;
$$;

revoke all on function public.register_device(text, text, boolean) from public;
grant execute on function public.register_device(text, text, boolean) to anon, authenticated;

create index if not exists fuel_adjustments_effective_idx on public.fuel_adjustments (effective_date desc);
create index if not exists fuel_headlines_published_idx on public.fuel_headlines (published_at desc);
