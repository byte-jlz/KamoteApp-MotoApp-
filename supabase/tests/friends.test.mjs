import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIG = fileURLToPath(new URL('../migrations', import.meta.url));
const db = new PGlite();

// Minimal stand-in for Supabase: roles, auth schema, auth.uid(), default grants (as Supabase does).
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
  console.log(`migrations pass ${pass} OK (${files.length} files)`);
}

const id = (n) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`;
const A = id(1), B = id(2), C = id(3), D = id(4), E = id(5), T = id(6), F = id(7), ADM = id(8), G = id(9);
const riders = [[A, 'rider_a', 'Ann'], [B, 'Rider_B', 'Ben'], [C, 'rider_c', 'Cat'], [D, 'rider_d', 'Dan'],
  [E, 'rider_e', 'Eve'], [T, 'rider_t', 'Tom'], [F, 'rider_f', 'Fay'], [ADM, 'admin1', 'Adm'], [G, 'rider_g', 'Gus']];
const extra = Array.from({ length: 31 }, (_, i) => [id(100 + i), `extra_${i}`, `X${i}`]);
for (const [uid, username, full_name] of [...riders, ...extra]) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [uid, `${username}@x.com`, JSON.stringify({ username, full_name })]);
}
await db.exec(`
  update public.profiles set role = 'admin' where id = '${ADM}';
  update public.profiles set disabled = true where id = '${E}';
  update public.profiles set must_change_password = true where id = '${T}';
`);

let failures = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
async function as(role, uid, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try {
    const r = await db.query(sql, params);
    return { rows: r.rows, affected: r.affectedRows };
  } catch (e) {
    return { error: e.message };
  } finally {
    await db.exec('reset role');
  }
}
const rider = (uid, sql, params) => as('authenticated', uid, sql, params);
const val = async (uid, sql, params) => {
  const r = await rider(uid, sql, params);
  if (r.error) return `ERROR: ${r.error}`;
  return Object.values(r.rows[0] ?? {})[0];
};
const su = (sql, params) => db.query(sql, params);
const resetLookups = () => su(`delete from public.social_events where kind = 'lookup'`);
const friendsOf = async (uid) => (await rider(uid, 'select * from public.list_friends()')).rows ?? [];
const statusOf = async (viewer, target) => (await friendsOf(viewer)).find((r) => r.id === target);

// ── Permissions ──
ok('anon cannot call heartbeat', !!(await as('anon', null, 'select public.heartbeat()')).error);
ok('anon cannot call find_rider', !!(await as('anon', null, `select * from public.find_rider('rider_a')`)).error);
ok('anon cannot read friendships', !!(await as('anon', null, 'select * from public.friendships')).error);
for (const t of ['presence', 'friend_codes', 'quick_add_codes', 'social_events']) {
  ok(`rider cannot read ${t}`, !!(await rider(A, `select * from public.${t}`)).error);
}
for (const f of ['social_me()', 'presence_status($1, $2)', 'social_visible($1, $2)', 'new_social_code()']) {
  const params = f.includes('$') ? [A, B] : undefined;
  ok(`internal ${f} not callable`, !!(await rider(A, `select public.${f}`, params)).error);
}

// ── Search ──
let r = await rider(A, `select * from public.find_rider('RIDER_B')`);
ok('exact username found, case-insensitive', r.rows?.length === 1 && r.rows[0].username === 'rider_b' && r.rows[0].full_name === 'Ben');
ok('search returns no email', r.rows && !Object.keys(r.rows[0]).some((k) => /mail/.test(k)), Object.keys(r.rows?.[0] ?? {}).join(','));
ok('partial username not found', (await rider(A, `select * from public.find_rider('rider')`)).rows.length === 0);
ok('wildcard not found', (await rider(A, `select * from public.find_rider('rider_%')`)).rows.length === 0);
ok('disabled account not found', (await rider(A, `select * from public.find_rider('rider_e')`)).rows.length === 0);
ok('temp-password account not found', (await rider(A, `select * from public.find_rider('rider_t')`)).rows.length === 0);
ok('searching yourself says self', (await val(A, `select relation from public.find_rider('rider_a')`)) === 'self');
ok('temp-password rider cannot search', /not_allowed/.test((await rider(T, `select * from public.find_rider('rider_a')`)).error ?? ''));
ok('disabled rider cannot heartbeat', /not_allowed/.test((await rider(E, `select public.heartbeat()`)).error ?? ''));

// ── Requests ──
ok('cannot request yourself', (await val(A, 'select public.send_friend_request($1)', [A])) === 'not_found');
ok('cannot request disabled', (await val(A, 'select public.send_friend_request($1)', [E])) === 'not_found');
ok('A sends request to B', (await val(A, 'select public.send_friend_request($1)', [B])) === 'requested');
ok('second send says already_requested', (await val(A, 'select public.send_friend_request($1)', [B])) === 'already_requested');
ok('B heartbeat shows 1 incoming', (await val(B, 'select public.heartbeat()')) === 1);
ok('B sees incoming request', (await friendsOf(B)).some((x) => x.id === A && x.relation === 'incoming' && x.status === null));
ok('A sees outgoing request', (await friendsOf(A)).some((x) => x.id === B && x.relation === 'outgoing'));
ok('pending request shows no status', (await statusOf(A, B))?.status === null);
ok('sender cannot accept own request', (await val(A, 'select public.respond_friend_request($1, true)', [B])) === 'not_found');
ok('stranger cannot accept for B', (await val(C, 'select public.respond_friend_request($1, true)', [A])) === 'not_found');
ok('rider cannot insert accepted row directly',
  !!(await rider(C, `insert into public.friendships (user_low, user_high, requester, status) values ('${C}', '${D}', '${C}', 'accepted')`)).error);
ok('rider cannot update friendship directly',
  !!(await rider(A, `update public.friendships set status = 'accepted'`)).error);
ok('rider cannot delete friendship directly', !!(await rider(A, `delete from public.friendships`)).error);
ok('pair row still pending', (await su(`select status from public.friendships`)).rows[0]?.status === 'pending');
ok('B accepts', (await val(B, 'select public.respond_friend_request($1, true)', [A])) === 'accepted');
ok('A and B are friends', (await statusOf(A, B))?.relation === 'friend' && (await statusOf(B, A))?.relation === 'friend');
ok('stranger C cannot see A-B row', (await rider(C, 'select * from public.friendships')).rows.length === 0);
ok('A sees own friendship row', (await rider(A, 'select * from public.friendships')).rows.length === 1);

// ── Constraints ──
ok('self-pair row rejected by constraint',
  !!(await su(`insert into public.friendships (user_low, user_high, requester) values ('${C}', '${C}', '${C}')`).catch((e) => ({ error: e.message }))).error);
ok('second row for same pair rejected (reversed order)',
  !!(await su(`insert into public.friendships (user_low, user_high, requester) values ('${B}', '${A}', '${B}')`).catch((e) => ({ error: e.message }))).error);
ok('second row for same pair rejected (same order)',
  !!(await su(`insert into public.friendships (user_low, user_high, requester) values ('${A}', '${B}', '${B}')`).catch((e) => ({ error: e.message }))).error);

// ── Online status ──
ok('never seen = offline', (await statusOf(B, A))?.status === 'offline');
await rider(A, 'select public.heartbeat()');
ok('after heartbeat = online', (await statusOf(B, A))?.status === 'online');
const s0 = await statusOf(B, A);
ok('no timestamp returned', !('last_seen' in s0) && s0.minutes_ago === null);
await su(`update public.presence set last_seen = now() - interval '15 minutes' where user_id = '${A}'`);
let s = await statusOf(B, A);
ok('15 min ago = recent 15', s?.status === 'recent' && s?.minutes_ago === 15, JSON.stringify(s));
await su(`update public.presence set last_seen = now() - interval '3 hours' where user_id = '${A}'`);
s = await statusOf(B, A);
ok('3h ago = recent 180', s?.status === 'recent' && s?.minutes_ago === 180, JSON.stringify(s));
await su(`update public.presence set last_seen = now() - interval '2 days' where user_id = '${A}'`);
ok('2 days ago = offline', (await statusOf(B, A))?.status === 'offline');
await rider(A, 'select public.heartbeat()');
ok('get_rider gives status to friend', (await val(B, 'select status from public.get_rider($1)', [A])) === 'online');
ok('stranger: get_rider has no status', (await rider(C, 'select * from public.get_rider($1)', [A])).rows[0]?.status === null);
ok('stranger: A not in list', !(await friendsOf(C)).some((x) => x.id === A));
ok('stranger cannot read presence', !!(await rider(C, `select last_seen from public.presence where user_id = '${A}'`)).error);
ok('profiles do not expose others', (await rider(C, `select * from public.profiles where id = '${A}'`)).rows.length === 0);

// Privacy OFF: hidden both ways.
await rider(B, 'select public.heartbeat()');
ok('A sees B online before', (await statusOf(A, B))?.status === 'online');
await rider(A, 'select public.set_show_online(false)');
ok('setting reads back off', (await val(A, 'select show_online from public.get_social_settings()')) === false);
ok('privacy off: B sees A offline', (await statusOf(B, A))?.status === 'offline');
ok('privacy off: A sees B offline too', (await statusOf(A, B))?.status === 'offline');
ok('privacy off clears last_seen', (await su(`select last_seen from public.presence where user_id = '${A}'`)).rows[0].last_seen === null);
await rider(A, 'select public.heartbeat()');
ok('privacy off: heartbeat stores nothing', (await su(`select last_seen from public.presence where user_id = '${A}'`)).rows[0].last_seen === null);
await rider(A, 'select public.set_show_online(true)');
await rider(A, 'select public.heartbeat()');
ok('privacy back on: online again', (await statusOf(B, A))?.status === 'online' && (await statusOf(A, B))?.status === 'online');

// ── Mutual requests ──
ok('C requests D', (await val(C, 'select public.send_friend_request($1)', [D])) === 'requested');
ok('D requests C back = accepted', (await val(D, 'select public.send_friend_request($1)', [C])) === 'accepted');
ok('C and D are friends', (await statusOf(C, D))?.relation === 'friend');

// ── Cancel / decline / unfriend ──
ok('F requests G', (await val(F, 'select public.send_friend_request($1)', [G])) === 'requested');
ok('receiver cannot cancel', (await val(G, 'select public.cancel_friend_request($1)', [F])) === 'not_found');
ok('sender cancels', (await val(F, 'select public.cancel_friend_request($1)', [G])) === 'ok');
await rider(F, 'select public.send_friend_request($1)', [G]);
ok('receiver declines', (await val(G, 'select public.respond_friend_request($1, false)', [F])) === 'declined');
ok('declined row gone', (await friendsOf(F)).length === 0);
ok('C unfriends D', (await val(C, 'select public.unfriend($1)', [D])) === 'ok' && (await friendsOf(D)).length === 0);

// ── Blocking ──
await resetLookups();
ok('D blocks A', (await val(D, 'select public.block_rider($1)', [A])) === 'ok');
ok('blocked A cannot find D', (await rider(A, `select * from public.find_rider('rider_d')`)).rows.length === 0);
ok('D cannot find A either', (await rider(D, `select * from public.find_rider('rider_a')`)).rows.length === 0);
ok('blocked A cannot request D', (await val(A, 'select public.send_friend_request($1)', [D])) === 'not_found');
ok('blocked A: get_rider(D) empty', (await rider(A, 'select * from public.get_rider($1)', [D])).rows.length === 0);
ok('D sees own block', (await rider(D, 'select * from public.blocks')).rows.length === 1);
ok('A cannot see D blocked them', (await rider(A, 'select * from public.blocks')).rows.length === 0);
ok('list_blocked shows A to D', (await rider(D, 'select * from public.list_blocked()')).rows[0]?.username === 'rider_a');
ok('rider cannot insert block directly', !!(await rider(A, `insert into public.blocks values ('${A}', '${C}')`)).error);
ok('B blocks friend A', (await val(B, 'select public.block_rider($1)', [A])) === 'ok');
ok('block removed friendship', (await friendsOf(A)).every((x) => x.id !== B) && (await friendsOf(B)).length === 0);
ok('B unblocks A', (await val(B, 'select public.unblock_rider($1)', [A])) === 'ok');
ok('after unblock: found again, not friends', (await val(A, `select relation from public.find_rider('rider_b')`)) === 'none');
await rider(C, 'select public.send_friend_request($1)', [G]);
await rider(G, 'select public.block_rider($1)', [C]);
ok('block removes pending request', (await friendsOf(C)).every((x) => x.id !== G));

// ── Disabled friends ──
await rider(F, 'select public.send_friend_request($1)', [C]);
await rider(C, 'select public.respond_friend_request($1, true)', [F]);
await su(`update public.profiles set disabled = true where id = '${F}'`);
ok('disabled friend hidden from list', !(await friendsOf(C)).some((x) => x.id === F));
ok('disabled rider cannot list friends', /not_allowed/.test((await rider(F, 'select * from public.list_friends()')).error ?? ''));
ok('disabled rider cannot read friendships', (await rider(F, 'select * from public.friendships')).rows.length === 0);
await su(`update public.profiles set disabled = false where id = '${F}'`);
ok('re-enabled friend is back', (await friendsOf(C)).some((x) => x.id === F));

// ── 30 requests per day ──
const X = extra.map((e) => e[0]);
let last;
for (let i = 0; i < 30; i++) last = await val(G, 'select public.send_friend_request($1)', [X[i]]);
ok('30th request allowed', last === 'requested');
ok('31st request refused', (await val(G, 'select public.send_friend_request($1)', [X[30]])) === 'rate_limited');
for (let i = 0; i < 5; i++) await rider(G, 'select public.cancel_friend_request($1)', [X[i]]);
ok('cancelling does not refund', (await val(G, 'select public.send_friend_request($1)', [X[0]])) === 'rate_limited');
ok('mutual accept still works over the limit', await (async () => {
  await rider(X[30], 'select public.send_friend_request($1)', [G]);
  return (await val(G, 'select public.send_friend_request($1)', [X[30]])) === 'accepted';
})());
await su(`update public.social_events set at = now() - interval '25 hours' where user_id = '${G}'`);
ok('allowed again after 24h', (await val(G, 'select public.send_friend_request($1)', [X[0]])) === 'requested');

// ── 60 lookups per hour ──
await resetLookups();
for (let i = 0; i < 60; i++) await rider(C, `select * from public.find_rider('nobody')`);
ok('61st lookup refused', /rate_limited/.test((await rider(C, `select * from public.find_rider('rider_a')`)).error ?? ''));
ok('code lookup shares the limit', /rate_limited/.test((await rider(C, `select * from public.find_rider_by_code('ABCDEFGH')`)).error ?? ''));
await resetLookups();

// ── Friend codes ──
const code1 = await val(A, 'select public.my_friend_code()');
ok('code is 8 chars, no look-alikes', /^[2-9A-HJKMNP-Z]{8}$/.test(code1), code1);
ok('same code on second call', (await val(A, 'select public.my_friend_code()')) === code1);
const many = new Set();
for (let i = 0; i < 200; i++) many.add((await su('select public.new_social_code() c')).rows[0].c);
ok('codes look random', many.size === 200 && [...many].every((c) => /^[2-9A-HJKMNP-Z]{8}$/.test(c)));
ok('C finds A by code', (await val(C, 'select username from public.find_rider_by_code($1)', [code1])) === 'rider_a');
ok('lowercase code works', (await val(C, 'select username from public.find_rider_by_code($1)', [code1.toLowerCase()])) === 'rider_a');
ok('code lookup returns no email/id leak beyond id', !Object.keys((await rider(C, 'select * from public.find_rider_by_code($1)', [code1])).rows[0]).some((k) => /mail/.test(k)));
const code2 = await val(A, 'select public.reset_friend_code()');
ok('reset gives new code', code2 !== code1 && /^[2-9A-HJKMNP-Z]{8}$/.test(code2));
ok('old code fails after reset', (await rider(C, 'select * from public.find_rider_by_code($1)', [code1])).rows.length === 0);
ok('old code cannot add after reset', (await val(C, 'select public.add_friend_by_code($1)', [code1])) === 'not_found');
ok('new code works', (await val(C, 'select username from public.find_rider_by_code($1)', [code2])) === 'rider_a');
ok('scanning normal code only sends request', (await val(C, 'select public.add_friend_by_code($1)', [code2])) === 'requested'
  && (await statusOf(A, C))?.relation === 'incoming');
ok('scanning own code says self', (await val(A, 'select relation from public.find_rider_by_code($1)', [code2])) === 'self');
ok('own code cannot add self', (await val(A, 'select public.add_friend_by_code($1)', [code2])) === 'not_found');
ok('blocked rider scan returns not found', (await rider(D, 'select * from public.find_rider_by_code($1)', [code2])).rows.length === 0);
ok('blocked rider add-by-code returns not found', (await val(D, 'select public.add_friend_by_code($1)', [code2])) === 'not_found');
const codeT = (await su(`insert into public.friend_codes (user_id, code) values ('${T}', public.new_social_code()) returning code`)).rows[0].code;
ok('temp-password owner code not found', (await rider(C, 'select * from public.find_rider_by_code($1)', [codeT])).rows.length === 0);
ok('garbage code not found', (await rider(C, `select * from public.find_rider_by_code('../x')`)).rows.length === 0);

// ── Quick add ──
await resetLookups();
const q1 = (await rider(B, 'select * from public.create_quick_add_code()')).rows[0];
ok('quick code made, 10 min', /^[2-9A-HJKMNP-Z]{8}$/.test(q1.code) && Math.abs(new Date(q1.expires_at) - Date.now() - 600000) < 5000);
ok('quick code lookup says quick', (await val(C, 'select quick from public.find_rider_by_code($1)', [q1.code])) === true);
ok('quick code accepts at once', (await val(C, 'select public.add_friend_by_code($1)', [q1.code])) === 'accepted'
  && (await statusOf(B, C))?.relation === 'friend');
ok('quick code fails after use', (await val(G, 'select public.add_friend_by_code($1)', [q1.code])) === 'not_found'
  && (await rider(G, 'select * from public.find_rider_by_code($1)', [q1.code])).rows.length === 0);
const q2 = (await rider(B, 'select * from public.create_quick_add_code()')).rows[0];
await su(`update public.quick_add_codes set expires_at = now() - interval '1 second' where code = $1`, [q2.code]);
ok('quick code fails after 10 minutes', (await val(G, 'select public.add_friend_by_code($1)', [q2.code])) === 'not_found');
const q3 = (await rider(B, 'select * from public.create_quick_add_code()')).rows[0];
const q4 = (await rider(B, 'select * from public.create_quick_add_code()')).rows[0];
ok('new quick code cancels the previous one', (await val(G, 'select public.add_friend_by_code($1)', [q3.code])) === 'not_found');
await rider(B, 'select public.cancel_quick_add_code()');
ok('turning quick add off cancels the code', (await val(G, 'select public.add_friend_by_code($1)', [q4.code])) === 'not_found');
await rider(B, 'select public.block_rider($1)', [D]);
const q5 = (await rider(B, 'select * from public.create_quick_add_code()')).rows[0];
ok('blocked rider cannot use quick code', (await val(D, 'select public.add_friend_by_code($1)', [q5.code])) === 'not_found');
ok('quick code still usable after blocked attempt', (await val(G, 'select public.add_friend_by_code($1)', [q5.code])) === 'accepted');

// ── Admin ──
const soc = (await rider(ADM, 'select * from public.admin_rider_social($1)', [A])).rows[0];
const expectA = (await su(`select count(*) filter (where status='accepted') f, count(*) filter (where status='pending' and requester <> '${A}') i,
  count(*) filter (where status='pending' and requester = '${A}') o from public.friendships where '${A}' in (user_low, user_high)`)).rows[0];
ok('admin sees counts', Number(soc.friends) === Number(expectA.f) && Number(soc.incoming) === Number(expectA.i) && Number(soc.outgoing) === Number(expectA.o), JSON.stringify(soc));
ok('admin counts have no ids', Object.keys(soc).join() === 'friends,incoming,outgoing');
ok('rider cannot call admin_rider_social', !!(await rider(A, 'select * from public.admin_rider_social($1)', [B])).error);
const total = (await su(`select count(*) n from public.friendships where status = 'accepted'`)).rows[0].n;
ok('admin_social_stats total', Number(await val(ADM, 'select friendships from public.admin_social_stats()')) === Number(total));
ok('rider cannot call admin_social_stats', !!(await rider(A, 'select * from public.admin_social_stats()')).error);

// ── Deleting an account removes everything ──
await rider(A, 'select public.block_rider($1)', [G]);
await rider(A, 'select * from public.create_quick_add_code()');
const countA = async () => (await su(`select
  (select count(*) from public.friendships where '${A}' in (user_low, user_high)) +
  (select count(*) from public.blocks where '${A}' in (blocker, blocked)) +
  (select count(*) from public.presence where user_id = '${A}') +
  (select count(*) from public.friend_codes where user_id = '${A}') +
  (select count(*) from public.quick_add_codes where user_id = '${A}') +
  (select count(*) from public.social_events where user_id = '${A}') n`)).rows[0].n;
ok('A has rows before delete', Number(await countA()) > 3, String(await countA()));
await su(`delete from auth.users where id = '${A}'`);
ok('deleting account removes friendships, requests, blocks, presence, codes', Number(await countA()) === 0);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
