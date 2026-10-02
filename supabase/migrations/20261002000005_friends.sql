-- MotoMonitor friends — 1 of 3: tables and Row Level Security. Safe to re-run.
-- Run after the four account migrations.
--
-- Riders change these tables ONLY through the database functions in the next two files:
--   • friendships / blocks: a rider can READ the rows they are part of (their own blocks only), never write.
--   • presence, friend codes and the rate-limit log: no policies at all, so nobody can read them through the API.
--     Online status is computed on the server and returned only for accepted friends.
-- Every table cascades from auth.users, so deleting an account removes its friendships, requests, blocks,
-- presence and codes.

-- One row per pair of riders, stored with the smaller id first, so a pair can never have two rows.
create table if not exists public.friendships (
  user_low uuid not null references auth.users (id) on delete cascade,
  user_high uuid not null references auth.users (id) on delete cascade,
  requester uuid not null,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_low, user_high),
  constraint friendships_ordered check (user_low < user_high), -- also rules out befriending yourself
  constraint friendships_requester check (requester = user_low or requester = user_high)
);

create index if not exists friendships_high_idx on public.friendships (user_high);

create table if not exists public.blocks (
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint blocks_not_self check (blocker <> blocked)
);

create index if not exists blocks_blocked_idx on public.blocks (blocked);

-- Kept out of profiles so last_seen can never leak through a profiles query.
create table if not exists public.presence (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Set by the server clock in heartbeat(); cleared when the rider hides their status.
  last_seen timestamptz,
  -- "Show my online status". Off = friends always see this rider as offline, and this rider sees friends as offline.
  show_online boolean not null default true
);

-- The rider's permanent QR code (until they reset it). 8 characters with no look-alikes (no 0/O, 1/I/L).
create table if not exists public.friend_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code text not null unique check (code ~ '^[2-9A-HJKMNP-Z]{8}$'),
  created_at timestamptz not null default now()
);

-- "Quick add" codes: valid 10 minutes, work once, and accept the friendship straight away.
create table if not exists public.quick_add_codes (
  code text primary key check (code ~ '^[2-9A-HJKMNP-Z]{8}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null
);

create index if not exists quick_add_codes_user_idx on public.quick_add_codes (user_id);

-- Rate limits: one row per friend request sent and per rider lookup (username or code).
create table if not exists public.social_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('request', 'lookup')),
  at timestamptz not null default now()
);

create index if not exists social_events_user_idx on public.social_events (user_id, kind, at);

-- ── Row Level Security ──

do $$
declare
  t text;
begin
  foreach t in array array['friendships', 'blocks', 'presence', 'friend_codes', 'quick_add_codes', 'social_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

grant select on public.friendships to authenticated;
grant select on public.blocks to authenticated;

drop policy if exists "Riders read own friendships" on public.friendships;
create policy "Riders read own friendships" on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (user_low, user_high) and (select public.can_use_app()));

drop policy if exists "Riders read own blocks" on public.blocks;
create policy "Riders read own blocks" on public.blocks
  for select to authenticated
  using (blocker = (select auth.uid()) and (select public.can_use_app()));

-- presence, friend_codes, quick_add_codes, social_events: no policies (server-side functions only).
