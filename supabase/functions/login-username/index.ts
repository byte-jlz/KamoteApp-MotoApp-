// MotoMonitor — log in with a username instead of an email.
//
// The app sends { username, password }. This function looks up the account's email on the server and signs in,
// returning only the session tokens, so riders' emails are never revealed to the phone.
// "Unknown username" and "wrong password" give the same answer. After 5 wrong tries a username is locked for 15 minutes.
//
// Never log the request body: it contains a password.
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/** Supabase provides either the legacy keys or the newer key dictionaries; use whichever exists. */
function key(legacy: string, dict: string) {
  const direct = Deno.env.get(legacy);
  if (direct) return direct;
  try {
    const keys = JSON.parse(Deno.env.get(dict) ?? '{}') as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? '';
  } catch {
    return '';
  }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = key('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
const ANON_KEY = key('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let username = '';
  let password = '';
  try {
    const body = await req.json();
    username = String(body.username ?? '').trim().toLowerCase();
    password = String(body.password ?? '');
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!USERNAME_RE.test(username) || !password || password.length > 128) {
    return json({ error: 'invalid_credentials' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, noSession);

  const { data: attempt } = await admin.from('login_attempts').select('*').eq('username', username).maybeSingle();
  if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
    return json({ error: 'too_many_attempts' }, 429);
  }

  const { data: profile } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
  let email: string | undefined;
  if (profile) {
    const { data } = await admin.auth.admin.getUserById(profile.id);
    email = data.user?.email ?? undefined;
  }

  if (email) {
    const client = createClient(SUPABASE_URL, ANON_KEY, noSession);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (data.session) {
      await admin.from('login_attempts').delete().eq('username', username);
      return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    }
    // These only happen after the password was accepted, so they don't help anyone guess.
    if (error?.code === 'email_not_confirmed' || error?.code === 'user_banned') {
      return json({ error: error.code }, 400);
    }
    if (error?.code === 'over_request_rate_limit') return json({ error: 'too_many_attempts' }, 429);
  }

  // Count the failure (also for unknown usernames, so both cases behave the same).
  const now = Date.now();
  const fresh = !attempt || now - new Date(attempt.window_start).getTime() > LOCK_MS;
  const failures = fresh ? 1 : attempt.failures + 1;
  await admin.from('login_attempts').upsert({
    username,
    failures,
    window_start: fresh ? new Date(now).toISOString() : attempt.window_start,
    locked_until: failures >= MAX_FAILURES ? new Date(now + LOCK_MS).toISOString() : null,
  });
  return json({ error: 'invalid_credentials' }, 400);
});
