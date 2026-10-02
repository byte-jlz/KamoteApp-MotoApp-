// MotoMonitor — admin actions that need the service key. Called by the admin website.
//
// The caller must be logged in AND have role 'admin' in profiles (checked here, not just on the website).
// Actions (POST JSON { action, ... }):
//   create               { email, full_name, username?, role? } → new account with a temporary password
//   reset_temp_password  { user_id }                            → new temporary password for an existing account
//   disable / enable     { user_id }                            → block / unblock logging in
//
// Temporary passwords are generated here, returned ONCE in the response, and never stored or logged anywhere.
// The account is flagged must_change_password, which only the change-password function can clear.
// Never log request or response bodies.
import { createClient } from 'npm:@supabase/supabase-js@2';

const TEMP_PASSWORD_LENGTH = 16;
const TEMP_PASSWORD_DAYS = 7;
const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FOREVER = '876000h'; // ~100 years

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
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
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ── Temporary passwords: letters + numbers + symbols, no look-alikes (0/O, 1/l/I), from a secure random source ──

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+?';

/** Unbiased random integer in [0, n). */
function randomIndex(n: number) {
  const limit = Math.floor(256 / n) * n;
  const b = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(b);
    if (b[0] < limit) return b[0] % n;
  }
}

function temporaryPassword() {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const chars = [UPPER, LOWER, DIGITS, SYMBOLS].map((set) => set[randomIndex(set.length)]);
  while (chars.length < TEMP_PASSWORD_LENGTH) chars.push(all[randomIndex(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function expiry() {
  return new Date(Date.now() + TEMP_PASSWORD_DAYS * 86_400_000).toISOString();
}

// ── Actions ──

async function create(body: Record<string, unknown>) {
  const email = String(body.email ?? '').trim().toLowerCase();
  const fullName = String(body.full_name ?? '').trim().slice(0, 100);
  const username = String(body.username ?? '').trim().toLowerCase();
  const role = body.role === 'admin' ? 'admin' : 'rider';
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'invalid_email' }, 400);
  if (!fullName) return json({ error: 'missing_name' }, 400);
  if (username) {
    if (!USERNAME_RE.test(username)) return json({ error: 'invalid_username' }, 400);
    const { data: taken } = await admin.from('profiles').select('id').eq('username', username).maybeSingle();
    if (taken) return json({ error: 'username_taken' }, 400);
  }

  const password = temporaryPassword();
  const expiresAt = expiry();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, ...(username ? { username } : {}) },
  });
  if (error || !data.user) {
    const code = error?.code === 'email_exists' || /already/i.test(error?.message ?? '') ? 'email_exists' : 'create_failed';
    return json({ error: code }, 400);
  }

  const { error: flagError } = await admin
    .from('profiles')
    .update({ role, must_change_password: true, temp_password_expires_at: expiresAt })
    .eq('id', data.user.id);
  if (flagError) {
    // Don't leave an account that could be used without the forced password change.
    await admin.auth.admin.deleteUser(data.user.id);
    return json({ error: 'create_failed' }, 500);
  }
  return json({ user_id: data.user.id, email, temporary_password: password, expires_at: expiresAt });
}

async function resetTempPassword(userId: string) {
  const password = temporaryPassword();
  const expiresAt = expiry();
  // Flag first: if setting the password then fails, the account is merely locked to the change screen.
  const { error: flagError } = await admin
    .from('profiles')
    .update({ must_change_password: true, temp_password_expires_at: expiresAt })
    .eq('id', userId);
  if (flagError) return json({ error: 'update_failed' }, 500);
  const { data, error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return json({ error: 'update_failed' }, 500);
  return json({ user_id: userId, email: data.user?.email ?? '', temporary_password: password, expires_at: expiresAt });
}

async function setDisabled(userId: string, disabled: boolean) {
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: disabled ? FOREVER : 'none' });
  if (error) return json({ error: 'update_failed' }, 500);
  const { error: flagError } = await admin.from('profiles').update({ disabled }).eq('id', userId);
  if (flagError) return json({ error: 'update_failed' }, 500);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Who is calling, and are they an admin? (getUser checks the token with Supabase Auth.)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const caller = userData?.user;
  if (userError || !caller) return json({ error: 'not_logged_in' }, 401);
  const { data: me } = await admin.from('profiles').select('role, disabled').eq('id', caller.id).maybeSingle();
  if (!me || me.role !== 'admin' || me.disabled) return json({ error: 'not_admin' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const action = String(body.action ?? '');
  if (action === 'create') return create(body);

  const userId = String(body.user_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: 'bad_request' }, 400);
  if (userId === caller.id) return json({ error: 'cannot_target_self' }, 400);
  const { data: target } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (!target) return json({ error: 'not_found' }, 404);

  switch (action) {
    case 'reset_temp_password':
      return resetTempPassword(userId);
    case 'disable':
      return setDisabled(userId, true);
    case 'enable':
      return setDisabled(userId, false);
    default:
      return json({ error: 'unknown_action' }, 400);
  }
});
