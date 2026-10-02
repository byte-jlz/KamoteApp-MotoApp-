// MotoMonitor — change the logged-in rider's password and clear the "must change password" flag.
//
// This is the ONLY way the flag gets cleared, so a rider can't skip the forced change by calling the API directly.
// The app sends either:
//   { current_password, new_password }  normal change, or the forced change after a temporary password
//   { new_password }                     right after "Forgot password": the emailed code already proved the rider
//                                        owns the address (the session must have been made by that code < 15 min ago)
//
// Never log the request body: it contains passwords.
import { createClient } from 'npm:@supabase/supabase-js@2';

const MIN_LENGTH = 8;
const MAX_LENGTH = 72; // Supabase Auth limit
const EMAIL_CODE_WINDOW_S = 15 * 60;

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

/** True if this session was created by an emailed code (password recovery) in the last 15 minutes. */
function madeByEmailCode(jwt: string) {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)));
    const now = Date.now() / 1000;
    return (claims.amr ?? []).some(
      (a: { method?: string; timestamp?: number }) =>
        (a.method === 'otp' || a.method === 'recovery') && now - (a.timestamp ?? 0) < EMAIL_CODE_WINDOW_S,
    );
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, noSession);

  // Who is calling? (getUser checks the token with Supabase Auth, so the claims below can be trusted.)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user?.email) return json({ error: 'not_logged_in' }, 401);

  let current = '';
  let next = '';
  try {
    const body = await req.json();
    current = typeof body.current_password === 'string' ? body.current_password : '';
    next = typeof body.new_password === 'string' ? body.new_password : '';
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (next.length < MIN_LENGTH || next.length > MAX_LENGTH) return json({ error: 'weak_password' }, 400);

  const { data: profile } = await admin
    .from('profiles')
    .select('must_change_password, temp_password_expires_at, disabled')
    .eq('id', user.id)
    .single();
  if (!profile || profile.disabled) return json({ error: 'account_disabled' }, 403);

  if (current) {
    if (next === current) return json({ error: 'same_password' }, 400);
    const expires = profile.temp_password_expires_at ? new Date(profile.temp_password_expires_at).getTime() : null;
    if (profile.must_change_password && expires !== null && expires < Date.now()) {
      return json({ error: 'temp_expired' }, 400);
    }
    // Check the current password by signing in with it, then throw that extra session away.
    const check = createClient(SUPABASE_URL, ANON_KEY, noSession);
    const { data: signIn, error: signInError } = await check.auth.signInWithPassword({ email: user.email, password: current });
    if (signInError || !signIn.session) {
      return json({ error: signInError?.code === 'over_request_rate_limit' ? 'too_many_attempts' : 'wrong_password' }, 400);
    }
    await admin.auth.admin.signOut(signIn.session.access_token, 'local');
  } else if (!madeByEmailCode(jwt)) {
    return json({ error: 'wrong_password' }, 400);
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password: next });
  if (updateError) {
    const code = updateError.code === 'weak_password' || updateError.code === 'same_password' ? updateError.code : 'update_failed';
    return json({ error: code }, 400);
  }

  const { error: flagError } = await admin
    .from('profiles')
    .update({ must_change_password: false, temp_password_expires_at: null })
    .eq('id', user.id);
  if (flagError) return json({ error: 'update_failed' }, 500);

  return json({ ok: true });
});
