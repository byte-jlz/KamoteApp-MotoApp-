-- MotoMonitor accounts — 3 of 4: Row Level Security and permissions. Safe to re-run.
--
-- The anon key ships inside the APK, so assume anyone can call the API with it:
--   • anon (not logged in) gets NOTHING on these tables.
--   • A rider reads/writes only their own rows, and only while their account is usable
--     (not disabled, not waiting to change a temporary password).
--   • An admin can READ everything. Admin changes (create user, disable, reset password) go
--     through Edge Functions, which use the service_role key on the server.
--   • Nobody can DELETE through the API: rows are soft-deleted; whole accounts are removed by the
--     delete-account Edge Function (auth user delete cascades to every table).

-- ── Helpers (security definer so policies can read profiles without recursion) ──

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and not disabled
  );
$$;

create or replace function public.can_use_app()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and not disabled and not must_change_password
  );
$$;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.can_use_app() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_use_app() to authenticated;

-- Trigger-only functions: not callable through the API.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.sync_guard() from public, anon, authenticated;

-- ── profiles ──

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
-- Riders may change only these columns. role, must_change_password, temp_password_expires_at,
-- disabled and privacy_consent_at can't be changed from the app at all.
grant update (username, full_name, settings, client_updated_at) on public.profiles to authenticated;

drop policy if exists "Riders read own profile" on public.profiles;
create policy "Riders read own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles" on public.profiles
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "Riders update own profile" on public.profiles;
create policy "Riders update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and (select public.can_use_app()))
  with check (id = (select auth.uid()));

-- ── Rider data tables ──

do $$
declare
  t text;
begin
  foreach t in array array['bikes', 'maint_items', 'odometer_readings', 'service_logs', 'clubs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);

    execute format('drop policy if exists "Riders read own rows" on public.%I', t);
    execute format(
      'create policy "Riders read own rows" on public.%I for select to authenticated
         using (user_id = (select auth.uid()) and (select public.can_use_app()))', t);

    execute format('drop policy if exists "Admins read all rows" on public.%I', t);
    execute format(
      'create policy "Admins read all rows" on public.%I for select to authenticated
         using ((select public.is_admin()))', t);

    execute format('drop policy if exists "Riders add own rows" on public.%I', t);
    execute format(
      'create policy "Riders add own rows" on public.%I for insert to authenticated
         with check (user_id = (select auth.uid()) and (select public.can_use_app()))', t);

    execute format('drop policy if exists "Riders change own rows" on public.%I', t);
    execute format(
      'create policy "Riders change own rows" on public.%I for update to authenticated
         using (user_id = (select auth.uid()) and (select public.can_use_app()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- ── Username login throttle (used only by the login-username Edge Function) ──

create table if not exists public.login_attempts (
  username text primary key,
  failures int not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);

alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;
-- No policies: only the service_role key (Edge Functions) can read or write it.

-- ── Small functions the app calls ──

-- Sign-up form: "is this username free?" Answers yes/no only; never reveals whose it is.
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(p_username) ~ '^[a-z0-9_.]{3,20}$'
     and not exists (select 1 from public.profiles where username = lower(p_username));
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- Records that the logged-in rider agreed to the privacy notice (used by admin-created accounts,
-- which never saw the sign-up screen). The time is set by the server, not the phone.
create or replace function public.record_privacy_consent(p_version text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
  set privacy_consent_at = now(), privacy_version = left(p_version, 20)
  where id = (select auth.uid());
$$;

revoke all on function public.record_privacy_consent(text) from public, anon;
grant execute on function public.record_privacy_consent(text) to authenticated;
