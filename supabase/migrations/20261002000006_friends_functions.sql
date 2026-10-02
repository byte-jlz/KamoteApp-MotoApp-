-- MotoMonitor friends — 2 of 3: functions the app calls. Safe to re-run.
--
-- Every function checks that the caller is logged in AND can use the app (not disabled, not waiting to change a
-- temporary password). Riders never write the friend tables directly, so:
--   • only the RECEIVER can accept a request (respond_friend_request), and nobody can create an accepted row;
--   • "not found" looks the same for: no such username, disabled or temporary-password accounts, riders I
--     blocked and riders who blocked me;
--   • online status is only returned for accepted friends, as 'online' / 'recent' (+ minutes ago) / 'offline',
--     never as a timestamp.
-- Error codes reach the app as the exception message: 'not_allowed', 'rate_limited'.

-- ── Internal helpers (not callable through the API) ──

-- The logged-in rider's id, or an error if they can't use the app right now.
create or replace function public.social_me()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not public.can_use_app() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_me;
end;
$$;

-- Can p_viewer see p_target at all? (exists, usable account, no block in either direction)
create or replace function public.social_visible(p_viewer uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_target is not null
    and p_target <> p_viewer
    and exists (select 1 from public.profiles p where p.id = p_target and not p.disabled and not p.must_change_password)
    and not exists (
      select 1 from public.blocks b
      where (b.blocker = p_viewer and b.blocked = p_target) or (b.blocker = p_target and b.blocked = p_viewer)
    );
$$;

-- 'self' | 'friends' | 'outgoing' (I asked) | 'incoming' (they asked) | 'none'
create or replace function public.social_relation(p_me uuid, p_other uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_me = p_other then 'self'
    else coalesce(
      (select case when f.status = 'accepted' then 'friends' when f.requester = p_me then 'outgoing' else 'incoming' end
       from public.friendships f
       where f.user_low = least(p_me, p_other) and f.user_high = greatest(p_me, p_other)),
      'none')
  end;
$$;

-- Records one event if the rider is under the limit. Returns false (and records nothing) when over it.
-- The lock makes two calls at the same moment count one after the other.
create or replace function public.social_take(p_user uuid, p_kind text, p_limit int, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('social:' || p_kind || ':' || p_user::text, 0));
  delete from public.social_events e
  where e.user_id = p_user and e.kind = p_kind and e.at < now() - interval '2 days';
  if (select count(*) from public.social_events e
      where e.user_id = p_user and e.kind = p_kind and e.at > now() - p_window) >= p_limit then
    return false;
  end if;
  insert into public.social_events (user_id, kind) values (p_user, p_kind);
  return true;
end;
$$;

-- Online status of p_target as seen by p_viewer. Callers must already know they are accepted friends.
create or replace function public.presence_status(p_viewer uuid, p_target uuid, out status text, out minutes_ago int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer_on boolean := coalesce((select pr.show_online from public.presence pr where pr.user_id = p_viewer), true);
  v_target_on boolean;
  v_seen timestamptz;
begin
  select pr.show_online, pr.last_seen into v_target_on, v_seen from public.presence pr where pr.user_id = p_target;
  status := 'offline';
  -- Reciprocal: if either rider hides their status, both see each other as offline.
  if not v_viewer_on or not coalesce(v_target_on, true) or v_seen is null then
    return;
  end if;
  if v_seen > now() - interval '2 minutes' then
    status := 'online';
  elsif v_seen > now() - interval '24 hours' then
    status := 'recent';
    minutes_ago := greatest(1, floor(extract(epoch from now() - v_seen) / 60))::int;
  end if;
end;
$$;

-- ── Presence ──

-- Called by the app about once a minute while it is open. The time comes from the server clock.
-- Returns the number of incoming friend requests (for the tab badge).
create or replace function public.heartbeat()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  -- Riders who hide their status are not tracked at all.
  update public.presence set last_seen = now() where user_id = v_me and show_online;
  if not found then
    insert into public.presence (user_id, last_seen) values (v_me, now()) on conflict (user_id) do nothing;
  end if;
  return (
    select count(*)::int
    from public.friendships f
    join public.profiles p on p.id = f.requester and not p.disabled and not p.must_change_password
    where f.status = 'pending' and f.requester <> v_me and v_me in (f.user_low, f.user_high)
  );
end;
$$;

drop function if exists public.get_social_settings();
create function public.get_social_settings()
returns table (show_online boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  return query select coalesce((select pr.show_online from public.presence pr where pr.user_id = v_me), true);
end;
$$;

-- Turning it off also forgets when the rider was last seen.
create or replace function public.set_show_online(p_show boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  insert into public.presence as pr (user_id, show_online, last_seen)
  values (v_me, coalesce(p_show, true), null)
  on conflict (user_id) do update
    set show_online = excluded.show_online,
        last_seen = case when excluded.show_online then pr.last_seen else null end;
end;
$$;

-- ── Finding riders ──

-- Exact username only (case-insensitive). At most 60 lookups (username or code) per rider per hour.
drop function if exists public.find_rider(text);
create function public.find_rider(p_username text)
returns table (id uuid, username text, full_name text, relation text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := public.social_me();
  v_name text := lower(trim(coalesce(p_username, '')));
  v_id uuid;
begin
  if not public.social_take(v_me, 'lookup', 60, interval '1 hour') then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if v_name !~ '^[a-z0-9_.]{3,20}$' then
    return;
  end if;
  select p.id into v_id from public.profiles p where p.username = v_name;
  if v_id is null or (v_id <> v_me and not public.social_visible(v_me, v_id)) then
    return;
  end if;
  return query
  select p.id, p.username, p.full_name, public.social_relation(v_me, p.id)
  from public.profiles p where p.id = v_id;
end;
$$;

-- The rider card (for someone already in my lists or just found). Status only for friends.
drop function if exists public.get_rider(uuid);
create function public.get_rider(p_id uuid)
returns table (id uuid, username text, full_name text, relation text, status text, minutes_ago int)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := public.social_me();
  v_rel text;
begin
  if p_id is null or (p_id <> v_me and not public.social_visible(v_me, p_id)) then
    return;
  end if;
  v_rel := public.social_relation(v_me, p_id);
  return query
  select p.id, p.username, p.full_name, v_rel,
         case when v_rel = 'friends' then ps.status end,
         case when v_rel = 'friends' then ps.minutes_ago end
  from public.profiles p
  cross join lateral public.presence_status(v_me, p.id) ps
  where p.id = p_id;
end;
$$;

-- Friends (with status) and pending requests in both directions, in one call.
-- relation: 'friend' | 'incoming' | 'outgoing'. since: when we became friends, or when the request was sent.
drop function if exists public.list_friends();
create function public.list_friends()
returns table (id uuid, username text, full_name text, relation text, status text, minutes_ago int, since timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := public.social_me();
begin
  return query
  select o.other, p.username, p.full_name,
         case when f.status = 'accepted' then 'friend' when f.requester = v_me then 'outgoing' else 'incoming' end,
         case when f.status = 'accepted' then ps.status end,
         case when f.status = 'accepted' then ps.minutes_ago end,
         coalesce(f.accepted_at, f.created_at)
  from public.friendships f
  cross join lateral (select case when f.user_low = v_me then f.user_high else f.user_low end as other) o
  join public.profiles p on p.id = o.other and not p.disabled and not p.must_change_password
  cross join lateral public.presence_status(v_me, o.other) ps
  where v_me in (f.user_low, f.user_high)
  order by lower(coalesce(nullif(p.full_name, ''), p.username, ''));
end;
$$;

drop function if exists public.list_blocked();
create function public.list_blocked()
returns table (id uuid, username text, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := public.social_me();
begin
  return query
  select p.id, p.username, p.full_name
  from public.blocks b
  join public.profiles p on p.id = b.blocked
  where b.blocker = v_me
  order by b.created_at desc;
end;
$$;

-- ── Requests ──

-- Returns 'requested' | 'accepted' (they had already asked me) | 'already_requested' | 'already_friends'
--       | 'rate_limited' (30 per 24 hours) | 'not_found'
create or replace function public.send_friend_request(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
  v_lo uuid := least(v_me, p_id);
  v_hi uuid := greatest(v_me, p_id);
  v_row public.friendships;
begin
  if not public.social_visible(v_me, p_id) then
    return 'not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pair:' || v_lo::text || ':' || v_hi::text, 0));
  select * into v_row from public.friendships f where f.user_low = v_lo and f.user_high = v_hi;
  if found then
    if v_row.status = 'accepted' then
      return 'already_friends';
    elsif v_row.requester = v_me then
      return 'already_requested';
    end if;
    -- Both asked each other: that's a yes from both.
    update public.friendships f set status = 'accepted', accepted_at = now()
    where f.user_low = v_lo and f.user_high = v_hi;
    return 'accepted';
  end if;
  if not public.social_take(v_me, 'request', 30, interval '24 hours') then
    return 'rate_limited';
  end if;
  insert into public.friendships (user_low, user_high, requester) values (v_lo, v_hi, v_me);
  return 'requested';
end;
$$;

-- Sender takes back a pending request. Returns 'ok' | 'not_found'.
create or replace function public.cancel_friend_request(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  delete from public.friendships f
  where f.user_low = least(v_me, p_id) and f.user_high = greatest(v_me, p_id)
    and f.status = 'pending' and f.requester = v_me;
  return case when found then 'ok' else 'not_found' end;
end;
$$;

-- Receiver accepts or declines a request FROM p_id. Only the receiver can: the row must have been sent by p_id.
-- Returns 'accepted' | 'declined' | 'not_found'.
create or replace function public.respond_friend_request(p_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  if p_id is null or p_id = v_me then
    return 'not_found';
  end if;
  if coalesce(p_accept, false) then
    if not public.social_visible(v_me, p_id) then
      return 'not_found';
    end if;
    update public.friendships f set status = 'accepted', accepted_at = now()
    where f.user_low = least(v_me, p_id) and f.user_high = greatest(v_me, p_id)
      and f.status = 'pending' and f.requester = p_id;
    return case when found then 'accepted' else 'not_found' end;
  end if;
  delete from public.friendships f
  where f.user_low = least(v_me, p_id) and f.user_high = greatest(v_me, p_id)
    and f.status = 'pending' and f.requester = p_id;
  return case when found then 'declined' else 'not_found' end;
end;
$$;

-- Returns 'ok' | 'not_found'.
create or replace function public.unfriend(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  delete from public.friendships f
  where f.user_low = least(v_me, p_id) and f.user_high = greatest(v_me, p_id) and f.status = 'accepted';
  return case when found then 'ok' else 'not_found' end;
end;
$$;

-- Blocking also removes any friendship or pending request between us. Returns 'ok' | 'not_found'.
create or replace function public.block_rider(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  if p_id is null or p_id = v_me or not exists (select 1 from public.profiles p where p.id = p_id) then
    return 'not_found';
  end if;
  insert into public.blocks (blocker, blocked) values (v_me, p_id) on conflict do nothing;
  delete from public.friendships f where f.user_low = least(v_me, p_id) and f.user_high = greatest(v_me, p_id);
  return 'ok';
end;
$$;

create or replace function public.unblock_rider(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  delete from public.blocks b where b.blocker = v_me and b.blocked = p_id;
  return case when found then 'ok' else 'not_found' end;
end;
$$;

-- ── Admin web page: counts only, never who the friends are ──

drop function if exists public.admin_rider_social(uuid);
create function public.admin_rider_social(p_id uuid)
returns table (friends bigint, incoming bigint, outgoing bigint)
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
  select
    count(*) filter (where f.status = 'accepted'),
    count(*) filter (where f.status = 'pending' and f.requester <> p_id),
    count(*) filter (where f.status = 'pending' and f.requester = p_id)
  from public.friendships f
  where p_id in (f.user_low, f.user_high);
end;
$$;

drop function if exists public.admin_social_stats();
create function public.admin_social_stats()
returns table (friendships bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  return query select count(*) from public.friendships f where f.status = 'accepted';
end;
$$;

-- ── Permissions ──

revoke all on function public.social_me() from public, anon, authenticated;
revoke all on function public.social_visible(uuid, uuid) from public, anon, authenticated;
revoke all on function public.social_relation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.social_take(uuid, text, int, interval) from public, anon, authenticated;
revoke all on function public.presence_status(uuid, uuid) from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'heartbeat()', 'get_social_settings()', 'set_show_online(boolean)',
    'find_rider(text)', 'get_rider(uuid)', 'list_friends()', 'list_blocked()',
    'send_friend_request(uuid)', 'cancel_friend_request(uuid)', 'respond_friend_request(uuid, boolean)',
    'unfriend(uuid)', 'block_rider(uuid)', 'unblock_rider(uuid)',
    'admin_rider_social(uuid)', 'admin_social_stats()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
