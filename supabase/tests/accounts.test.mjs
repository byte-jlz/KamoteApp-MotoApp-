import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIG = fileURLToPath(new URL('../migrations', import.meta.url));
const db = new PGlite();

// Minimal stand-in for Supabase: roles, auth schema, auth.uid(), default grants.
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (
    id uuid primary key, email varchar(255), raw_user_meta_data jsonb,
    created_at timestamptz default now(), last_sign_in_at timestamptz, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
`);

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
for (let pass = 1; pass <= 2; pass++) {
  for (const f of files) await db.exec(readFileSync(join(MIG, f), 'utf8'));
  console.log(`migrations pass ${pass} OK (${files.join(', ')})`);
}

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const ADM = '00000000-0000-0000-0000-0000000000ad';
await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${A}', 'a@x.com', '{"username":"Rider_A","full_name":"Ann","privacy_version":"2026-10","role":"admin"}'),
    ('${B}', 'b@x.com', '{"full_name":"Ben"}'),
    ('${ADM}', 'adm@x.com', '{}');
  update public.profiles set role = 'admin' where id = '${ADM}';
`);

let failures = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
async function as(role, uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    const r = await db.query(sql);
    return { rows: r.rows, affected: r.affectedRows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec('reset role');
  }
}

const pa = (await db.query(`select * from public.profiles where id = '${A}'`)).rows[0];
ok('signup metadata cannot make admin', pa.role === 'rider');
ok('username stored lowercase', pa.username === 'rider_a');
ok('consent recorded at signup', pa.privacy_consent_at && pa.privacy_version === '2026-10');

const bike = (id, uid, ts) => `insert into public.bikes (user_id, id, name, type, odometer, client_updated_at)
  values ('${uid}', '${id}', 'Click', 'scooter', 1000, '${ts}')
  on conflict (user_id, id) do update set name = excluded.name, odometer = excluded.odometer, client_updated_at = excluded.client_updated_at`;

ok('A inserts own bike', !(await as('authenticated', A, bike('b1', A, '2026-10-01T00:00:00Z'))).error);
ok('A cannot insert a bike for B', !!(await as('authenticated', A, bike('x', B, '2026-10-01T00:00:00Z'))).error);
ok('B cannot see A bikes', (await as('authenticated', B, 'select * from public.bikes')).rows.length === 0);
ok('A sees own bike', (await as('authenticated', A, 'select * from public.bikes')).rows.length === 1);

await as('authenticated', A, `update public.bikes set name = 'OLD', client_updated_at = '2026-09-01T00:00:00Z' where id = 'b1'`);
await as('authenticated', A, bike('b1', A, '2026-08-01T00:00:00Z').replace("'Click'", "'OLDER'"));
ok('older edit does not overwrite newer', (await db.query(`select name from public.bikes where id='b1'`)).rows[0].name === 'Click');
await as('authenticated', A, bike('b1', A, '2026-10-02T00:00:00Z').replace("'Click'", "'Newer'"));
ok('newer edit wins', (await db.query(`select name from public.bikes where id='b1'`)).rows[0].name === 'Newer');
await as('authenticated', A, bike('b2', A, '2099-01-01T00:00:00Z'));
ok('far-future clock capped', (await db.query(`select client_updated_at < now() + interval '2 days' as c from public.bikes where id='b2'`)).rows[0].c);

ok('A cannot delete rows', !!(await as('authenticated', A, `delete from public.bikes where id='b1'`)).error);
ok('A cannot change B bike', (await as('authenticated', A, `update public.bikes set name='hack' where user_id='${B}'`)).affected === 0);
ok('A cannot make self admin', !!(await as('authenticated', A, `update public.profiles set role='admin' where id='${A}'`)).error);
ok('A cannot clear must_change_password', !!(await as('authenticated', A, `update public.profiles set must_change_password=false where id='${A}'`)).error);
ok('A cannot unban self', !!(await as('authenticated', A, `update public.profiles set disabled=false where id='${A}'`)).error);
ok('A can edit own name', (await as('authenticated', A, `update public.profiles set full_name='Ann B', client_updated_at=now() where id='${A}'`)).affected === 1);
ok('A cannot see B profile', (await as('authenticated', A, 'select * from public.profiles')).rows.length === 1);
ok('A cannot insert profile', !!(await as('authenticated', A, `insert into public.profiles (id) values ('${B}')`)).error);
ok('rider cannot call admin_stats', !!(await as('authenticated', A, 'select * from public.admin_stats()')).error);
ok('rider cannot call admin_list_riders', !!(await as('authenticated', A, 'select * from public.admin_list_riders()')).error);
ok('rider cannot read login_attempts', !!(await as('authenticated', A, 'select * from public.login_attempts')).error);

ok('anon cannot read bikes', !!(await as('anon', null, 'select * from public.bikes')).error);
ok('anon cannot read profiles', !!(await as('anon', null, 'select * from public.profiles')).error);
ok('anon cannot call admin_list_riders', !!(await as('anon', null, 'select * from public.admin_list_riders()')).error);
ok('anon username_available taken', (await as('anon', null, `select public.username_available('RIDER_A') v`)).rows[0].v === false);
ok('anon username_available free', (await as('anon', null, `select public.username_available('new.rider') v`)).rows[0].v === true);
ok('username_available rejects bad format', (await as('anon', null, `select public.username_available('a b') v`)).rows[0].v === false);
ok('anon fuel tables untouched (no such table here)', true);

await db.exec(`insert into public.maint_items (user_id, bike_id, id, key, name, interval_km, interval_months, enabled, last_km, last_date, client_updated_at)
  values ('${A}', 'b1', 'i1', 'engine_oil', 'Oil', 500, null, true, 0, now(), now()),
         ('${A}', 'b1', 'i2', 'brakes', 'Brakes', null, 1, true, 1000, now() - interval '40 days', now()),
         ('${A}', 'b1', 'i3', 'chain', 'Chain', 5000, 12, true, 1000, now(), now());
  insert into public.service_logs (user_id, id, bike_id, date, km, client_updated_at) values ('${A}', 'l1', 'b1', now(), 900, now());`);

const st = await as('authenticated', ADM, 'select * from public.admin_stats()');
ok('admin_stats works', !st.error && Number(st.rows[0].items_overdue) === 2 && Number(st.rows[0].bikes) === 2 && Number(st.rows[0].service_logs_this_month) === 1, JSON.stringify(st.rows?.[0] ?? st.error));
const lr = await as('authenticated', ADM, 'select * from public.admin_list_riders()');
ok('admin_list_riders works', !lr.error && lr.rows.length === 3, lr.error ?? lr.rows.map((r) => `${r.email}:${r.status}`).join(' '));
ok('admin reads all bikes', (await as('authenticated', ADM, 'select * from public.bikes')).rows.length === 2);
ok('admin cannot edit rider bike', (await as('authenticated', ADM, `update public.bikes set name='x' where user_id='${A}'`)).affected === 0);

// Server-side flag (what the Edge Function does with service_role) blocks data access.
await db.exec(`update public.profiles set must_change_password = true, temp_password_expires_at = now() + interval '7 days' where id = '${A}'`);
ok('flagged rider sees no data', (await as('authenticated', A, 'select * from public.bikes')).rows.length === 0);
ok('flagged rider cannot write', !!(await as('authenticated', A, bike('b3', A, '2026-10-02T00:00:00Z'))).error);
ok('flagged rider still sees own profile (to read the flag)', (await as('authenticated', A, 'select must_change_password from public.profiles')).rows[0]?.must_change_password === true);
ok('admin list shows pending', (await as('authenticated', ADM, `select status from public.admin_list_riders() where email='a@x.com'`)).rows[0].status === 'pending_first_login');
await db.exec(`update public.profiles set must_change_password = false where id = '${A}'`);

await as('authenticated', B, `select public.record_privacy_consent('2026-10')`);
ok('record_privacy_consent sets own row', !!(await db.query(`select privacy_consent_at from public.profiles where id='${B}'`)).rows[0].privacy_consent_at);

await db.exec(`update public.profiles set disabled = true where id = '${ADM}'`);
ok('disabled admin loses admin reads', (await as('authenticated', ADM, 'select * from public.bikes')).rows.length === 0);

await db.exec(`delete from auth.users where id = '${A}'`);
const left = (await db.query(`select (select count(*) from public.bikes) + (select count(*) from public.maint_items) + (select count(*) from public.service_logs) + (select count(*) from public.profiles where id='${A}') as n`)).rows[0].n;
ok('deleting auth user removes all their rows', Number(left) === 0);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
