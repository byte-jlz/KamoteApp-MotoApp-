-- MotoMonitor accounts — 4 of 4: read-only functions for the admin web page. Safe to re-run.
-- Both refuse to run unless the caller's profile role is 'admin'.
-- Passwords are never selected: Supabase stores only hashes, and nothing here reads them.

drop function if exists public.admin_list_riders();
create function public.admin_list_riders()
returns table (
  id uuid,
  email text,
  username text,
  full_name text,
  role text,
  signed_up_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed boolean,
  disabled boolean,
  must_change_password boolean,
  temp_password_expires_at timestamptz,
  status text, -- 'disabled' | 'pending_first_login' | 'must_change_password' | 'temp_expired' | 'active'
  bikes bigint,
  service_logs bigint
)
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
    u.id,
    u.email::text,
    p.username,
    p.full_name,
    p.role,
    u.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at is not null,
    p.disabled,
    p.must_change_password,
    p.temp_password_expires_at,
    case
      when p.disabled then 'disabled'
      when p.must_change_password and p.temp_password_expires_at < now() then 'temp_expired'
      when p.must_change_password and u.last_sign_in_at is null then 'pending_first_login'
      when p.must_change_password then 'must_change_password'
      else 'active'
    end,
    (select count(*) from public.bikes b where b.user_id = u.id and not b.deleted),
    (select count(*) from public.service_logs l where l.user_id = u.id and not l.deleted)
  from auth.users u
  join public.profiles p on p.id = u.id
  order by u.created_at desc;
end;
$$;

-- "Overdue" matches the app (src/lib/status.ts): a tracked item is overdue once the km since it was
-- last done reaches its km interval, or its month interval has passed — whichever comes first.
drop function if exists public.admin_stats();
create function public.admin_stats()
returns table (
  riders bigint,
  bikes bigint,
  service_logs_this_month bigint,
  items_overdue bigint
)
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
    (select count(*) from public.profiles where role = 'rider'),
    (select count(*) from public.bikes where not deleted),
    (select count(*) from public.service_logs
      where not deleted
        and date >= (date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila')),
    (select count(*)
      from public.maint_items i
      join public.bikes b on b.user_id = i.user_id and b.id = i.bike_id and not b.deleted
      where not i.deleted
        and i.enabled
        and (
          (coalesce(i.interval_km, 0) > 0 and b.odometer - i.last_km >= i.interval_km)
          or (coalesce(i.interval_months, 0) > 0 and i.last_date + i.interval_months * interval '1 month' <= now())
        ));
end;
$$;

revoke all on function public.admin_list_riders() from public, anon;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_list_riders() to authenticated;
grant execute on function public.admin_stats() to authenticated;
