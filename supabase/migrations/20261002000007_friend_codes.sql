-- MotoMonitor friends — 3 of 3: QR friend codes and "Quick add". Safe to re-run.
--
-- A QR holds only a random 8-character code, never a user id or email. Codes are looked up here on the server,
-- with the same rules as username search ("not found" for blocked, disabled and temporary-password accounts) and
-- the same 60 lookups per hour. Scanning a normal code only SENDS a request; a Quick add code (10 minutes, one use)
-- accepts the friendship straight away, because its owner chose to show it.

-- A new random code that is not in use. 31 characters (no 0/O, 1/I/L), from the server's secure random generator.
create or replace function public.new_social_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_byte int;
  v_code text;
begin
  loop
    v_code := '';
    while length(v_code) < 8 loop
      v_bytes := uuid_send(gen_random_uuid());
      for i in 0..15 loop
        continue when i in (6, 8); -- these bytes hold the UUID version/variant, not randomness
        v_byte := get_byte(v_bytes, i);
        continue when v_byte >= 248; -- 248 = 8 × 31, so every character is equally likely
        v_code := v_code || substr(v_alphabet, v_byte % 31 + 1, 1);
        exit when length(v_code) = 8;
      end loop;
    end loop;
    exit when not exists (select 1 from public.friend_codes c where c.code = v_code)
      and not exists (select 1 from public.quick_add_codes q where q.code = v_code);
  end loop;
  return v_code;
end;
$$;

-- My QR code (made the first time it's asked for).
create or replace function public.my_friend_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
  v_code text;
begin
  select c.code into v_code from public.friend_codes c where c.user_id = v_me;
  if v_code is null then
    insert into public.friend_codes (user_id, code) values (v_me, public.new_social_code())
    on conflict (user_id) do nothing;
    select c.code into v_code from public.friend_codes c where c.user_id = v_me;
  end if;
  return v_code;
end;
$$;

-- New code; the old one stops working immediately.
create or replace function public.reset_friend_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
  v_code text := public.new_social_code();
begin
  insert into public.friend_codes (user_id, code) values (v_me, v_code)
  on conflict (user_id) do update set code = excluded.code, created_at = now();
  return v_code;
end;
$$;

-- Quick add: a one-time code valid for 10 minutes. Making a new one cancels the previous one.
drop function if exists public.create_quick_add_code();
create function public.create_quick_add_code()
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := public.social_me();
begin
  delete from public.quick_add_codes q
  where q.user_id = v_me and (q.used_at is null or q.used_at < now() - interval '1 day');
  return query
  insert into public.quick_add_codes as q (code, user_id, expires_at)
  values (public.new_social_code(), v_me, now() + interval '10 minutes')
  returning q.code, q.expires_at;
end;
$$;

create or replace function public.cancel_quick_add_code()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
begin
  delete from public.quick_add_codes q where q.user_id = v_me and q.used_at is null;
end;
$$;

-- What a scanned code points to. quick = true for a Quick add code (adding makes you friends right away).
drop function if exists public.find_rider_by_code(text);
create function public.find_rider_by_code(p_code text)
returns table (id uuid, username text, full_name text, relation text, quick boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := public.social_me();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_owner uuid;
  v_quick boolean := false;
begin
  if not public.social_take(v_me, 'lookup', 60, interval '1 hour') then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if v_code !~ '^[2-9A-HJKMNP-Z]{8}$' then
    return;
  end if;
  select c.user_id into v_owner from public.friend_codes c where c.code = v_code;
  if v_owner is null then
    select q.user_id into v_owner from public.quick_add_codes q
    where q.code = v_code and q.used_at is null and q.expires_at > now();
    v_quick := v_owner is not null;
  end if;
  if v_owner is null or (v_owner <> v_me and not public.social_visible(v_me, v_owner)) then
    return;
  end if;
  return query
  select p.id, p.username, p.full_name, public.social_relation(v_me, p.id), v_quick
  from public.profiles p where p.id = v_owner;
end;
$$;

-- Add the owner of a scanned code. Normal code: same as send_friend_request (30/day, owner must accept).
-- Quick add code: friends straight away, and the code is used up.
-- Returns 'requested' | 'accepted' | 'already_requested' | 'already_friends' | 'rate_limited' | 'not_found'.
create or replace function public.add_friend_by_code(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.social_me();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_owner uuid;
  v_quick public.quick_add_codes;
  v_lo uuid;
  v_hi uuid;
  v_row public.friendships;
begin
  if not public.social_take(v_me, 'lookup', 60, interval '1 hour') then
    return 'rate_limited';
  end if;
  if v_code !~ '^[2-9A-HJKMNP-Z]{8}$' then
    return 'not_found';
  end if;

  select c.user_id into v_owner from public.friend_codes c where c.code = v_code;
  if v_owner is not null then
    return public.send_friend_request(v_owner);
  end if;

  -- Locking the code row means two riders scanning it at once can't both use it.
  select * into v_quick from public.quick_add_codes q
  where q.code = v_code and q.used_at is null and q.expires_at > now()
  for update;
  if not found or not public.social_visible(v_me, v_quick.user_id) then
    return 'not_found';
  end if;

  v_lo := least(v_me, v_quick.user_id);
  v_hi := greatest(v_me, v_quick.user_id);
  perform pg_advisory_xact_lock(hashtextextended('pair:' || v_lo::text || ':' || v_hi::text, 0));
  select * into v_row from public.friendships f where f.user_low = v_lo and f.user_high = v_hi;
  if found and v_row.status = 'accepted' then
    return 'already_friends'; -- the code stays usable for someone else
  elsif found then
    update public.friendships f set status = 'accepted', accepted_at = now()
    where f.user_low = v_lo and f.user_high = v_hi;
  else
    if not public.social_take(v_me, 'request', 30, interval '24 hours') then
      return 'rate_limited';
    end if;
    insert into public.friendships (user_low, user_high, requester, status, accepted_at)
    values (v_lo, v_hi, v_me, 'accepted', now());
  end if;
  update public.quick_add_codes q set used_at = now(), used_by = v_me where q.code = v_code;
  return 'accepted';
end;
$$;

-- ── Permissions ──

revoke all on function public.new_social_code() from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'my_friend_code()', 'reset_friend_code()', 'create_quick_add_code()', 'cancel_quick_add_code()',
    'find_rider_by_code(text)', 'add_friend_by_code(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
