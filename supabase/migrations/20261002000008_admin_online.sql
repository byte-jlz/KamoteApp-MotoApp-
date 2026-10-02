-- MotoMonitor admin page: who is online right now. Safe to re-run.
--
-- "Online" uses the same rule as the Friends tab: the app's heartbeat reached the server in the last 2 minutes.
-- Riders who turned off Active status are never listed: their last_seen is cleared and no longer recorded.
-- Returns names only, never the time a rider was last seen or who their friends are.

drop function if exists public.admin_online_riders();
create function public.admin_online_riders()
returns table (id uuid, full_name text, username text)
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
  select p.id, p.full_name, p.username
  from public.presence pr
  join public.profiles p on p.id = pr.user_id
  where pr.show_online
    and pr.last_seen > now() - interval '2 minutes'
    and not p.disabled
  order by lower(coalesce(nullif(p.full_name, ''), p.username, ''));
end;
$$;

revoke all on function public.admin_online_riders() from public, anon;
grant execute on function public.admin_online_riders() to authenticated;
