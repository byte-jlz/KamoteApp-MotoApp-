// MotoMonitor — permanently delete the logged-in rider's account (Settings → Account → Delete account).
//
// The app sends { password }. The password is checked again here so a phone left unlocked and logged in
// can't be used to delete someone's account.
// Deleting the auth user removes everything stored online for that rider: every table references auth.users
// with "on delete cascade" (profile, bikes, maintenance, service logs, clubs, friends, blocks, presence, codes).
// Photos and videos are never uploaded, so there is nothing in Storage to remove.
// The last remaining admin can't delete their account, so the admin page always has someone who can open it.
//
// Never log the request body: it contains a password.
import { createClient } from 'npm:@supabase/supabase-js@2';

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

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, noSession);

  // Who is calling? (getUser checks the token with Supabase Auth.)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user?.email) return json({ error: 'not_logged_in' }, 401);

  let password = '';
  try {
    const body = await req.json();
    password = typeof body.password === 'string' ? body.password : '';
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!password) return json({ error: 'wrong_password' }, 400);

  const { data: profile } = await admin.from('profiles').select('role, disabled').eq('id', user.id).maybeSingle();
  if (profile?.disabled) return json({ error: 'account_disabled' }, 403);

  // Check the password by signing in with it, then throw that extra session away.
  const check = createClient(SUPABASE_URL, ANON_KEY, noSession);
  const { data: signIn, error: signInError } = await check.auth.signInWithPassword({ email: user.email, password });
  if (signInError || !signIn.session) {
    return json({ error: signInError?.code === 'over_request_rate_limit' ? 'too_many_attempts' : 'wrong_password' }, 400);
  }
  await admin.auth.admin.signOut(signIn.session.access_token, 'local');

  if (profile?.role === 'admin') {
    const { count, error } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('disabled', false)
      .neq('id', user.id);
    if (error) return json({ error: 'delete_failed' }, 500);
    if (!count) return json({ error: 'last_admin' }, 400);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) return json({ error: 'delete_failed' }, 500);

  return json({ ok: true });
});
