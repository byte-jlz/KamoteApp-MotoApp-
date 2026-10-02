// Nudges, alarms and replies (migration 9), plus linking phones to accounts in the devices table.
// The fuel schema (scraper/supabase/schema.sql) is loaded before and after the migrations, as in production.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIG = fileURLToPath(new URL('../migrations', import.meta.url));
const FUEL = fileURLToPath(new URL('../../scraper/supabase/schema.sql', import.meta.url));
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

await db.exec(readFileSync(FUEL, 'utf8'));
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
for (let pass = 1; pass <= 2; pass++) {
  for (const f of files) await db.exec(readFileSync(join(MIG, f), 'utf8'));
  console.log(`migrations pass ${pass} OK (${files.length} files)`);
}
await db.exec(readFileSync(FUEL, 'utf8'));
console.log('fuel schema re-run after migrations OK');

const id = (n) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, '0')}`;
// A: sender. B, C, F, G: A's friends. D: not a friend. E: friend who gets blocked. T: temporary password. X: disabled.
const A = id(1), B = id(2), C = id(3), D = id(4), E = id(5), F = id(6), G = id(7), T = id(8), X = id(9), ADM = id(10);
const riders = [[A, 'ann'], [B, 'ben'], [C, 'cat'], [D, 'dan'], [E, 'eve'], [F, 'fay'], [G, 'gus'], [T, 'tom'], [X, 'xia'], [ADM, 'adm']];
for (const [uid, username] of riders) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
    [uid, `${username}@x.com`, JSON.stringify({ username, full_name: username.toUpperCase() })]);
}

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
const su = (sql, params) => db.query(sql, params);
const one = async (uid, sql, params) => {
  const r = await rider(uid, sql, params);
  return r.error ? { error: r.error } : (r.rows[0] ?? {});
};
const nudge = (from, to, kind = 'nudge') => one(from, 'select * from public.prepare_nudge($1, $2)', [to, kind]);
const reply = (from, nudgeId, code) => one(from, 'select * from public.prepare_reply($1, $2)', [nudgeId, code]);
const card = (me, other) => one(me, 'select * from public.get_nudge_card($1)', [other]);
const ago = (sender, interval) => su(`update public.nudge_events set at = at - interval '${interval}' where sender = $1`, [sender]);
const clearEvents = () => su('delete from public.nudge_events');
const token = (n) => `fcm-token-${String(n).padStart(20, '0')}`;
const tokenOwner = async (t) => (await su('select user_id from public.devices where token = $1', [t])).rows[0]?.user_id ?? null;

// Friends: A with B, C, E, F, G (B also friends with C).
for (const [x, y] of [[A, B], [A, C], [A, E], [A, F], [A, G], [B, C]]) {
  await rider(x, 'select public.send_friend_request($1)', [y]);
  await rider(y, 'select public.respond_friend_request($1, true)', [x]);
}
ok('setup: A and B are friends', (await su(`select count(*) n from public.friendships where status = 'accepted'`)).rows[0].n == 6);
await su(`update public.profiles set must_change_password = true where id = '${T}'`);

// ── Phones ──
ok('anon cannot link a phone', !!(await as('anon', null, 'select public.link_device($1, $2)', [token(1), 'android'])).error);
ok('rider links phone', !(await rider(B, 'select public.link_device($1, $2)', [token(1), 'android'])).error);
ok('phone linked to B', (await tokenOwner(token(1))) === B);
ok('new phone from link starts with fuel alerts off', (await su('select fuel_alerts from public.devices where token = $1', [token(1)])).rows[0].fuel_alerts === false);
ok('too-short token rejected', !!(await rider(B, 'select public.link_device($1, $2)', ['short', 'android'])).error);
ok('temp-password account cannot link', !!(await rider(T, 'select public.link_device($1, $2)', [token(9), 'android'])).error);

await as('anon', null, 'select public.register_device($1, $2, $3)', [token(2), 'android', true]);
await rider(C, 'select public.link_device($1, $2)', [token(2), 'android']);
ok('link keeps an existing fuel-alert choice', (await su('select fuel_alerts from public.devices where token = $1', [token(2)])).rows[0].fuel_alerts === true);
await as('anon', null, 'select public.register_device($1, $2, $3)', [token(2), 'android', false]);
ok('register_device does not change the link', (await tokenOwner(token(2))) === C);

await rider(D, 'select public.link_device($1, $2)', [token(2), 'android']);
ok('same phone, new login: linked to the latest account only', (await tokenOwner(token(2))) === D &&
  (await su('select count(*) n from public.devices where token = $1', [token(2)])).rows[0].n == 1);
ok('anon can unlink a phone it knows the token of', !(await as('anon', null, 'select public.unlink_device($1)', [token(2)])).error);
ok('unlinked phone has no account but stays for fuel alerts', (await tokenOwner(token(2))) === null &&
  (await su('select count(*) n from public.devices where token = $1', [token(2)])).rows[0].n == 1);

for (const [who, sql] of [
  ['rider', 'select token from public.devices'],
  ['rider', 'select * from public.nudge_events'],
  ['rider', 'select * from public.nudge_mutes'],
  ['rider', 'select * from public.nudge_settings'],
]) {
  const r = await rider(A, sql);
  ok(`${who} cannot read: ${sql}`, !!r.error || r.rows.length === 0, r.error ? 'denied' : `${r.rows.length} rows`);
}
const anonRead = await as('anon', null, 'select token from public.devices');
ok('anon cannot read tokens', !!anonRead.error || anonRead.rows.length === 0);
ok('rider cannot write devices directly', !!(await rider(A, `update public.devices set user_id = '${A}'`)).error);
ok('rider cannot insert nudge events directly', !!(await rider(A, `insert into public.nudge_events (sender, receiver, kind) values ('${A}', '${B}', 'nudge')`)).error);
ok('rider cannot call nudge_wait', !!(await rider(A, `select public.nudge_wait('${A}', '${B}', 'nudge')`)).error);

// ── Who can nudge ──
await rider(A, 'select public.link_device($1, $2)', [token(3), 'android']);
ok('friend with a phone: send', (await nudge(A, B)).result === 'send');
await clearEvents();
ok('friend without a phone: no_device', (await nudge(A, C)).result === 'no_device');
ok('not a friend: not_allowed', (await nudge(A, D)).result === 'not_allowed');
ok('yourself: not_allowed', (await nudge(A, A)).result === 'not_allowed');
ok('bad kind: bad_request', (await nudge(A, B, 'reply')).result === 'bad_request');
ok('temp-password sender refused', !!(await nudge(T, A)).error);
await su(`update public.profiles set disabled = true where id = '${X}'`);
ok('disabled sender refused', !!(await nudge(X, A)).error);
ok('anon cannot prepare a nudge', !!(await as('anon', null, 'select * from public.prepare_nudge($1, $2)', [B, 'nudge'])).error);
await rider(E, 'select public.block_rider($1)', [A]);
ok('blocked by receiver: not_allowed', (await nudge(A, E)).result === 'not_allowed');
ok('blocker cannot nudge either', (await nudge(E, A)).result === 'not_allowed');
const sent = await nudge(A, B);
ok('sender username returned', sent.sender_username === 'ann' && sent.target === B && !!sent.event_id);
await clearEvents();

// ── Limits ──
ok('nudge 1 sends', (await nudge(A, B)).result === 'send');
const n2 = await nudge(A, B);
ok('second nudge within 10 s: rate_limited', n2.result === 'rate_limited' && n2.retry_after >= 1 && n2.retry_after <= 10, JSON.stringify(n2));
ok('nudge to another friend not limited', (await nudge(A, C)).result === 'no_device');
ok('alarm not limited by the nudge', (await nudge(A, B, 'alarm')).result === 'send');
await ago(A, '11 seconds');
ok('nudge allowed again after 10 s', (await nudge(A, B)).result === 'send');
const a2 = await nudge(A, B, 'alarm');
ok('second alarm within 5 min: rate_limited', a2.result === 'rate_limited' && a2.retry_after > 200 && a2.retry_after <= 300, JSON.stringify(a2));
await ago(A, '4 minutes');
ok('alarm still limited at 4 min', (await nudge(A, B, 'alarm')).result === 'rate_limited');
await ago(A, '61 seconds');
ok('alarm allowed again after 5 min', (await nudge(A, B, 'alarm')).result === 'send');
ok('rate-limited attempts are not recorded', (await su(`select count(*) n from public.nudge_events where sender = '${A}'`)).rows[0].n == 5);

await clearEvents();
await su(`insert into public.nudge_events (sender, receiver, kind, at)
  select '${A}', '${C}', 'nudge', now() - interval '50 minutes' + (i || ' seconds')::interval from generate_series(1, 59) i`);
ok('59 in the last hour: one more allowed', (await nudge(A, B)).result === 'send');
const cap = await nudge(A, F);
ok('60 per hour: next is rate_limited', cap.result === 'rate_limited' && cap.retry_after > 595 && cap.retry_after <= 602, JSON.stringify(cap));
ok('cap covers alarms too', (await nudge(A, G, 'alarm')).result === 'rate_limited');
await ago(A, '11 minutes');
ok('cap frees up as the oldest leave the hour', (await nudge(A, F)).result !== 'rate_limited');
await clearEvents();

// Replies count toward the cap.
const toA = await nudge(B, A);
await su(`insert into public.nudge_events (sender, receiver, kind, at)
  select '${A}', '${C}', 'nudge', now() - interval '30 minutes' from generate_series(1, 60)`);
const capReply = await reply(A, toA.event_id, 'thumbs_up');
ok('reply refused when sender is at 60 per hour', capReply.result === 'rate_limited', JSON.stringify(capReply));
await su(`delete from public.nudge_events where sender = '${A}' and receiver = '${C}' and id in (
  select id from public.nudge_events where sender = '${A}' and receiver = '${C}' limit 1)`);
ok('reply allowed at 59 per hour', (await reply(A, toA.event_id, 'thumbs_up')).result === 'send');
ok('that reply now counts: nudge refused', (await nudge(A, F)).result === 'rate_limited');
await clearEvents();

// ── Mute and settings ──
ok('mute: A mutes B', (await one(A, 'select public.set_nudge_mute($1, true) m', [B])).m === true);
const muted = await nudge(B, A);
ok('muted sender: suppressed (Edge Function says "sent")', muted.result === 'suppressed', JSON.stringify(muted));
ok('muted nudge still recorded for limits', (await nudge(B, A)).result === 'rate_limited');
ok('mute covers alarms', (await nudge(B, A, 'alarm')).result === 'suppressed');
ok('muter sees muted on card', (await card(A, B)).muted === true);
ok('muted rider cannot see the mute', (await card(B, A)).muted === false);
ok('suppressed nudge is not offered for a reply', (await card(A, B)).open_nudge_id === null);
ok('unmute', (await one(A, 'select public.set_nudge_mute($1, false) m', [B])).m === false);
ok('cannot mute yourself', !!(await rider(A, 'select public.set_nudge_mute($1, true)', [A])).error);
await clearEvents();

const defaults = await one(A, 'select * from public.get_nudge_settings()');
ok('settings default to on', defaults.allow_nudges === true && defaults.allow_alarms === true);
await one(A, 'select * from public.set_nudge_settings(true, false)');
ok('alarms off: alarm suppressed', (await nudge(B, A, 'alarm')).result === 'suppressed');
ok('alarms off: nudge still sent', (await nudge(B, A)).result === 'send');
await one(A, 'select * from public.set_nudge_settings(false, true)');
await ago(B, '11 seconds');
ok('nudges off: nudge suppressed', (await nudge(B, A)).result === 'suppressed');
const saved = await one(A, 'select * from public.get_nudge_settings()');
ok('settings saved on the server', saved.allow_nudges === false && saved.allow_alarms === true);
ok('settings are per rider', (await one(B, 'select * from public.get_nudge_settings()')).allow_nudges === true);
await one(A, 'select * from public.set_nudge_settings(true, true)');
await clearEvents();

// ── Replies ──
const al = await nudge(A, B, 'alarm');
ok('receiver sees the alarm as open on the card', (await card(B, A)).open_nudge_id === al.event_id && (await card(B, A)).open_nudge_kind === 'alarm');
ok('sender cannot reply to own alarm', (await reply(A, al.event_id, 'on_my_way')).result === 'not_allowed');
ok('third rider cannot reply', (await reply(C, al.event_id, 'on_my_way')).result === 'not_allowed');
ok('unknown nudge id: not_allowed', (await reply(B, id(999), 'on_my_way')).result === 'not_allowed');
ok('nudge-only code on an alarm: bad_request', (await reply(B, al.event_id, 'thumbs_up')).result === 'bad_request');
ok('free text is not a code: bad_request', (await reply(B, al.event_id, 'see you at 5')).result === 'bad_request');
const r1 = await reply(B, al.event_id, 'five_minutes');
ok('receiver replies', r1.result === 'send' && r1.target === A && r1.sender_username === 'ben', JSON.stringify(r1));
ok('second reply: already_replied', (await reply(B, al.event_id, 'on_my_way')).result === 'already_replied');
ok('reply stored as a code only', (await su(`select reply_code from public.nudge_events where id = '${r1.event_id}'`)).rows[0].reply_code === 'five_minutes');
const cA = await card(A, B);
ok('sender sees the latest reply on the card', cA.last_reply_code === 'five_minutes' && !!cA.last_reply_at);
ok('answered alarm no longer open for receiver', (await card(B, A)).open_nudge_id === null);
ok('a reply cannot be replied to', (await reply(A, r1.event_id, 'thumbs_up')).result === 'not_allowed');

const n1 = await nudge(A, B);
ok('nudge codes accepted on nudges', (await reply(B, n1.event_id, 'wait_for_me')).result === 'send');
ok('card shows the newest reply', (await card(A, B)).last_reply_code === 'wait_for_me');

await ago(A, '11 seconds');
const late = await nudge(A, B);
await su(`update public.nudge_events set at = now() - interval '31 minutes' where id = $1`, [late.event_id]);
ok('reply after 30 minutes: expired', (await reply(B, late.event_id, 'on_my_way')).result === 'expired');
ok('expired nudge not open on the card', (await card(B, A)).open_nudge_id === null);

// Replies ignore the original sender's settings, but respect their mute.
await clearEvents();
await one(A, 'select * from public.set_nudge_settings(false, false)');
const fromA = await nudge(A, B);
ok('reply delivered although the original sender turned nudges off', (await reply(B, fromA.event_id, 'thumbs_up')).result === 'send');
await one(A, 'select * from public.set_nudge_settings(true, true)');
await ago(A, '11 seconds');
const fromA2 = await nudge(A, B);
await rider(A, 'select public.set_nudge_mute($1, true)', [B]);
ok('reply suppressed when the original sender muted the replier', (await reply(B, fromA2.event_id, 'on_my_way')).result === 'suppressed');
await rider(A, 'select public.set_nudge_mute($1, false)', [B]);

// Blocks apply to replies.
const fromG = await nudge(G, A);
await rider(G, 'select public.block_rider($1)', [A]);
ok('reply to a rider who blocked me: not_allowed', (await reply(A, fromG.event_id, 'thumbs_up')).result === 'not_allowed');
ok('card shows nothing for a blocked rider', (await card(A, G)).open_nudge_id === null);

// ── Admin ──
await clearEvents();
await nudge(A, B);
await nudge(A, C, 'alarm');
const r2 = await nudge(B, A);
await reply(A, r2.event_id, 'thumbs_up');
await su(`insert into public.nudge_events (sender, receiver, kind, at) values ('${A}', '${F}', 'nudge', now() - interval '2 days')`);
await su(`update public.profiles set role = 'admin' where id = '${ADM}'`);
const stats = await one(ADM, 'select * from public.admin_nudge_stats()');
ok('admin: nudges + alarms sent today (no replies, not older)', Number(stats.nudges_today) === 3, JSON.stringify(stats));
ok('admin count has no ids or text', Object.keys(stats).join() === 'nudges_today');
ok('rider cannot call admin_nudge_stats', !!(await rider(A, 'select * from public.admin_nudge_stats()')).error);

// ── Deleting an account ──
await rider(B, 'select public.set_nudge_mute($1, true)', [A]);
await one(B, 'select * from public.set_nudge_settings(false, false)');
const countB = async () => (await su(`select
  (select count(*) from public.nudge_events where '${B}' in (sender, receiver)) +
  (select count(*) from public.nudge_mutes where '${B}' in (muter, muted)) +
  (select count(*) from public.nudge_settings where user_id = '${B}') n`)).rows[0].n;
ok('B has nudge rows before delete', Number(await countB()) > 2, String(await countB()));
await su(`delete from auth.users where id = '${B}'`);
ok('deleting account removes nudges, mutes, settings', Number(await countB()) === 0);
ok('deleting account unlinks the phone but keeps it for fuel alerts', (await tokenOwner(token(1))) === null &&
  (await su('select count(*) n from public.devices where token = $1', [token(1)])).rows[0].n == 1);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
