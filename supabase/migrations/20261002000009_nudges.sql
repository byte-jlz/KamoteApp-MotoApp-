-- MotoMonitor nudges: "👋 Nudge", "🚨 Alarm" and quick replies between friends. Safe to re-run.
--
-- Phones are linked to accounts through the existing devices table (made by scraper/supabase/schema.sql for
-- fuel alerts). A token is the table's primary key, so one phone is linked to at most ONE account: the latest
-- login. Deleting an account sets user_id to null rather than removing the row, so that phone keeps getting
-- fuel alerts but no longer gets nudges. register_device() is left exactly as it is (the scraper schema
-- re-creates it), and the scraper only reads token + fuel_alerts.
--
-- Rules (all checked here, in the database):
--   • only ACCEPTED friends, with no block either way and both accounts usable, can nudge each other;
--   • Nudge: 1 per sender→receiver per 10 seconds. Alarm: 1 per sender→receiver per 5 minutes.
--     Nudges, alarms and replies together: 60 per sender per hour;
--   • a receiver's mute or "allow" settings silently stop delivery, and the sender is told "sent" anyway
--     (the event is still recorded, so limits behave the same whether or not the sender is muted);
--   • a nudge/alarm can get ONE reply, only from its receiver, within 30 minutes, as a fixed code (never text).
--     Replies ignore the original sender's "allow" settings (they started it) but respect mutes and blocks.
-- Message text is never stored. Nobody can read tokens or these tables through the API: no policies at all.
-- The send-nudge Edge Function calls prepare_nudge / prepare_reply with the rider's own login, then reads
-- the target's tokens with the service key.

-- ── Phones ──

-- Same definition as scraper/supabase/schema.sql, so this also works on a project where that wasn't run yet.
create table if not exists public.devices (
  token text primary key,
  platform text not null,
  fuel_alerts boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
alter table public.devices enable row level security;
alter table public.devices add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.devices add column if not exists linked_at timestamptz;
create index if not exists devices_user_idx on public.devices (user_id) where user_id is not null;

-- ── Settings, mutes, events ──

-- No row = both allowed.
create table if not exists public.nudge_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  allow_nudges boolean not null default true,
  allow_alarms boolean not null default true,
  updated_at timestamptz not null default now()
);

-- muter doesn't receive nudges, alarms or replies from muted. Never visible to the muted rider.
create table if not exists public.nudge_mutes (
  muter uuid not null references auth.users (id) on delete cascade,
  muted uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter, muted),
  check (muter <> muted)
);

-- One row per nudge, alarm or reply that passed the checks (for limits, replies and the admin count).
-- Kept for 2 days. No message text.
create table if not exists public.nudge_events (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references auth.users (id) on delete cascade,
  receiver uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('nudge', 'alarm', 'reply')),
  at timestamptz not null default now(),
  -- Muted or turned off by the receiver: recorded, not delivered.
  suppressed boolean not null default false,
  -- Replies only: which nudge/alarm, and the chosen answer.
  reply_to uuid references public.nudge_events (id) on delete cascade,
  reply_code text,
  check ((kind = 'reply') = (reply_to is not null and reply_code is not null))
);
create index if not exists nudge_events_sender_idx on public.nudge_events (sender, at desc);
create index if not exists nudge_events_pair_idx on public.nudge_events (sender, receiver, kind, at desc);
create index if not exists nudge_events_receiver_idx on public.nudge_events (receiver, at desc);
-- One reply per nudge/alarm, even if two replies arrive at the same moment.
create unique index if not exists nudge_events_one_reply_idx on public.nudge_events (reply_to) where reply_to is not null;

do $$
declare
  t text;
begin
  foreach t in array array['nudge_settings', 'nudge_mutes', 'nudge_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;
revoke all on public.devices from anon, authenticated;

-- ── Internal helpers (not callable through the API) ──

-- Reply codes allowed for each kind. The app and the Edge Function hold the button labels.
create or replace function public.nudge_reply_ok(p_kind text, p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'alarm' then p_code in ('on_my_way', 'five_minutes', 'running_late', 'cant_make_it')
    when 'nudge' then p_code in ('thumbs_up', 'on_my_way', 'wait_for_me')
    else false
  end;
$$;

-- Seconds p_me must wait before sending p_kind to p_receiver (0 = go ahead). p_receiver null = hourly cap only.
-- Callers hold the sender's advisory lock, so two sends at the same moment are counted one after the other.
create or replace function public.nudge_wait(p_me uuid, p_receiver uuid, p_kind text)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pair interval := case p_kind when 'nudge' then interval '10 seconds' when 'alarm' then interval '5 minutes' end;
  v_last timestamptz;
  v_oldest timestamptz;
  v_wait int := 0;
begin
  if (select count(*) from public.nudge_events e where e.sender = p_me and e.at > now() - interval '1 hour') >= 60 then
    select min(x.at) into v_oldest from (
      select e.at from public.nudge_events e
      where e.sender = p_me and e.at > now() - interval '1 hour'
      order by e.at desc limit 60
    ) x;
    v_wait := ceil(extract(epoch from v_oldest + interval '1 hour' - now()))::int;
  end if;
  if p_receiver is not null and v_pair is not null then
    select max(e.at) into v_last from public.nudge_events e
    where e.sender = p_me and e.receiver = p_receiver and e.kind = p_kind and e.at > now() - v_pair;
    if v_last is not null then
      v_wait := greatest(v_wait, ceil(extract(epoch from v_last + v_pair - now()))::int);
    end if;
  end if;
  return greatest(v_wait, 0);
end;
$$;

-- ── Phones: link / unlink ──

-- Called after login and on app start while logged in. Moves the phone to this account (latest login wins).
-- A phone that isn't registered for fuel alerts yet starts with them off; register_device() sets the real choice.
create or replace function public.link_device(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 512 then
    raise exception 'invalid token';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'invalid platform';
  end if;
  insert into public.devices as d (token, platform, fuel_alerts, user_id, linked_at)
  values (p_token, p_platform, false, v_me, now())
  on conflict (token) do update
    set user_id = v_me, linked_at = now(), last_seen = now(), platform = excluded.platform;
end;
$$;

-- Called on log out. Works without a login too: only this phone knows its token, and the app retries after
-- an offline log out. The row stays for fuel alerts.
create or replace function public.unlink_device(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.devices set user_id = null, linked_at = null where token = p_token and user_id is not null;
$$;

-- ── Receiver settings ──

create or replace function public.get_nudge_settings()
returns table (allow_nudges boolean, allow_alarms boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  return query
  select coalesce(s.allow_nudges, true), coalesce(s.allow_alarms, true)
  from (select 1) one
  left join public.nudge_settings s on s.user_id = v_me;
end;
$$;

create or replace function public.set_nudge_settings(p_allow_nudges boolean, p_allow_alarms boolean)
returns table (allow_nudges boolean, allow_alarms boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  insert into public.nudge_settings as s (user_id, allow_nudges, allow_alarms)
  values (v_me, coalesce(p_allow_nudges, true), coalesce(p_allow_alarms, true))
  on conflict (user_id) do update
    set allow_nudges = excluded.allow_nudges, allow_alarms = excluded.allow_alarms, updated_at = now();
  return query select s.allow_nudges, s.allow_alarms from public.nudge_settings s where s.user_id = v_me;
end;
$$;

-- Mute or unmute nudges (both kinds, and replies) from one rider. Returns the new state.
create or replace function public.set_nudge_mute(p_rider uuid, p_muted boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  if p_rider is null or p_rider = v_me then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_muted then
    insert into public.nudge_mutes (muter, muted)
    select v_me, p_rider where exists (select 1 from public.profiles p where p.id = p_rider)
    on conflict do nothing;
  else
    delete from public.nudge_mutes m where m.muter = v_me and m.muted = p_rider;
  end if;
  return exists (select 1 from public.nudge_mutes m where m.muter = v_me and m.muted = p_rider);
end;
$$;

-- What the rider card shows about nudges with p_rider:
--   muted            I muted them (never shown to them);
--   last_reply_*     their latest reply to one of my nudges/alarms (last 24 hours);
--   open_nudge_*     their latest nudge/alarm to me that I can still answer (30 minutes, not answered, not muted).
create or replace function public.get_nudge_card(p_rider uuid)
returns table (
  muted boolean,
  last_reply_code text,
  last_reply_at timestamptz,
  open_nudge_id uuid,
  open_nudge_kind text,
  open_nudge_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
  v_friends boolean := public.social_relation(v_me, p_rider) = 'friends' and public.social_visible(v_me, p_rider);
begin
  return query
  select
    exists (select 1 from public.nudge_mutes m where m.muter = v_me and m.muted = p_rider),
    r.reply_code, r.at,
    o.id, o.kind, o.at
  from (select 1) one
  left join lateral (
    select e.reply_code, e.at from public.nudge_events e
    where v_friends and e.kind = 'reply' and e.sender = p_rider and e.receiver = v_me
      and e.at > now() - interval '24 hours'
    order by e.at desc limit 1
  ) r on true
  left join lateral (
    select e.id, e.kind, e.at from public.nudge_events e
    where v_friends and e.kind in ('nudge', 'alarm') and e.sender = p_rider and e.receiver = v_me
      and not e.suppressed and e.at > now() - interval '30 minutes'
      and not exists (select 1 from public.nudge_events x where x.reply_to = e.id)
    order by e.at desc limit 1
  ) o on true;
end;
$$;

-- ── Sending (called by the send-nudge Edge Function with the rider's login) ──
-- result: 'send' (deliver to target's phones) | 'suppressed' (say "sent", deliver nothing) | 'no_device'
--         | 'not_allowed' | 'rate_limited' (+ retry_after seconds) | 'expired' | 'already_replied' | 'bad_request'

create or replace function public.prepare_nudge(p_receiver uuid, p_kind text)
returns table (result text, event_id uuid, target uuid, sender_username text, retry_after int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
  v_wait int;
  v_suppressed boolean;
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('nudge', 'alarm') then
    return query select 'bad_request', null::uuid, null::uuid, null::text, null::int;
    return;
  end if;
  if public.social_relation(v_me, p_receiver) <> 'friends' or not public.social_visible(v_me, p_receiver) then
    return query select 'not_allowed', null::uuid, null::uuid, null::text, null::int;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nudge:' || v_me::text, 0));
  delete from public.nudge_events e where e.sender = v_me and e.at < now() - interval '2 days';
  v_wait := public.nudge_wait(v_me, p_receiver, p_kind);
  if v_wait > 0 then
    return query select 'rate_limited', null::uuid, null::uuid, null::text, v_wait;
    return;
  end if;

  v_suppressed :=
    exists (select 1 from public.nudge_mutes m where m.muter = p_receiver and m.muted = v_me)
    or not coalesce(
      (select case p_kind when 'nudge' then s.allow_nudges else s.allow_alarms end
       from public.nudge_settings s where s.user_id = p_receiver),
      true);
  insert into public.nudge_events (sender, receiver, kind, suppressed)
  values (v_me, p_receiver, p_kind, v_suppressed)
  returning id into v_id;

  return query select
    case
      when v_suppressed then 'suppressed'
      when not exists (select 1 from public.devices d where d.user_id = p_receiver) then 'no_device'
      else 'send'
    end,
    v_id, p_receiver,
    (select p.username from public.profiles p where p.id = v_me),
    null::int;
end;
$$;

create or replace function public.prepare_reply(p_nudge uuid, p_code text)
returns table (result text, event_id uuid, target uuid, sender_username text, retry_after int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
  v_orig record;
  v_wait int;
  v_suppressed boolean;
  v_id uuid;
begin
  select e.id, e.sender, e.receiver, e.kind, e.at into v_orig
  from public.nudge_events e where e.id = p_nudge and e.kind in ('nudge', 'alarm');
  -- Only the receiver can answer, and only while both can still see each other as friends.
  if v_orig.id is null or v_orig.receiver <> v_me
     or public.social_relation(v_me, v_orig.sender) <> 'friends' or not public.social_visible(v_me, v_orig.sender) then
    return query select 'not_allowed', null::uuid, null::uuid, null::text, null::int;
    return;
  end if;
  if not public.nudge_reply_ok(v_orig.kind, p_code) then
    return query select 'bad_request', null::uuid, null::uuid, null::text, null::int;
    return;
  end if;
  if v_orig.at < now() - interval '30 minutes' then
    return query select 'expired', null::uuid, null::uuid, null::text, null::int;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nudge:' || v_me::text, 0));
  if exists (select 1 from public.nudge_events x where x.reply_to = p_nudge) then
    return query select 'already_replied', null::uuid, null::uuid, null::text, null::int;
    return;
  end if;
  v_wait := public.nudge_wait(v_me, null, 'reply');
  if v_wait > 0 then
    return query select 'rate_limited', null::uuid, null::uuid, null::text, v_wait;
    return;
  end if;

  -- The original sender's "allow" settings don't apply (they started it); their mute does.
  v_suppressed := exists (select 1 from public.nudge_mutes m where m.muter = v_orig.sender and m.muted = v_me);
  begin
    insert into public.nudge_events (sender, receiver, kind, suppressed, reply_to, reply_code)
    values (v_me, v_orig.sender, 'reply', v_suppressed, p_nudge, p_code)
    returning id into v_id;
  exception when unique_violation then
    return query select 'already_replied', null::uuid, null::uuid, null::text, null::int;
    return;
  end;

  return query select
    case
      when v_suppressed then 'suppressed'
      when not exists (select 1 from public.devices d where d.user_id = v_orig.sender) then 'no_device'
      else 'send'
    end,
    v_id, v_orig.sender,
    (select p.username from public.profiles p where p.id = v_me),
    null::int;
end;
$$;

-- ── Admin web page: counts only, never who or what ──

drop function if exists public.admin_nudge_stats();
create function public.admin_nudge_stats()
returns table (nudges_today bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query
  select count(*) from public.nudge_events e
  where e.kind in ('nudge', 'alarm')
    and e.at >= (date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila');
end;
$$;

-- ── Permissions ──

revoke all on function public.nudge_reply_ok(text, text) from public, anon, authenticated;
revoke all on function public.nudge_wait(uuid, uuid, text) from public, anon, authenticated;

revoke all on function public.unlink_device(text) from public;
grant execute on function public.unlink_device(text) to anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'link_device(text, text)', 'get_nudge_settings()', 'set_nudge_settings(boolean, boolean)',
    'set_nudge_mute(uuid, boolean)', 'get_nudge_card(uuid)', 'prepare_nudge(uuid, text)', 'prepare_reply(uuid, text)',
    'admin_nudge_stats()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
