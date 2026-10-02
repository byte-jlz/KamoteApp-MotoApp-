// MotoMonitor — send a 👋 Nudge, a 🚨 Alarm, or a quick reply to one, between friends.
//
// POST JSON:
//   { action: 'nudge' | 'alarm', receiver_id, message? }   message: optional, max 100 characters, never stored
//   { action: 'reply', nudge_id, code }                    code: one of the fixed reply codes (never free text)
// Answers { status: 'sent' } or { status: 'no_device' }, or { error, retry_after? } with a 4xx/5xx status.
//
// Every rule lives in the database (migration 9): prepare_nudge / prepare_reply run with the rider's OWN login,
// so the friend, block, account and rate-limit checks can't be skipped. A mute or a turned-off setting answers
// 'sent' too, so a sender can't tell they were muted. Only then are the target's phone tokens read, with the
// service key, and the message is sent through Firebase Cloud Messaging (HTTP v1).
//
// Messages are DATA-ONLY on purpose: that is what makes expo-notifications build the notification itself,
// with the right channel and the reply buttons (category). A message with a `notification` block is shown by
// Android directly, without buttons.
//
// Secret: FIREBASE_SERVICE_ACCOUNT = the Firebase service account JSON (same project as the app).
// Never log message text, tokens or request bodies.
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_MESSAGE = 100;
const TTL = '1800s'; // a nudge is useless after the 30-minute reply window

const REPLY_LABELS: Record<string, string> = {
  on_my_way: 'On my way',
  five_minutes: '5 minutes',
  running_late: 'Running late',
  cant_make_it: 'Can’t make it',
  thumbs_up: '👍',
  wait_for_me: 'Wait for me',
};

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
const ANON_KEY = key('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, SERVICE_KEY, noSession);

// ── Firebase: service account → OAuth access token (cached ~55 minutes) ──

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let account: ServiceAccount | null = null;
let accessToken: { value: string; expires: number } | null = null;

function serviceAccount(): ServiceAccount {
  if (!account) {
    const parsed = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT') ?? '{}');
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) throw new Error('fcm_not_configured');
    account = parsed;
  }
  return account!;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

async function getAccessToken() {
  if (accessToken && accessToken.expires > Date.now() + 60_000) return accessToken.value;
  const sa = serviceAccount();
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const signingKey = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, new TextEncoder().encode(unsigned)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }),
  });
  if (!res.ok) throw new Error(`fcm_auth_${res.status}`);
  const body = await res.json();
  accessToken = { value: body.access_token, expires: Date.now() + Number(body.expires_in ?? 3600) * 1000 };
  return accessToken.value;
}

type SendOutcome = 'ok' | 'dead' | 'failed';

/** Send one data-only message. 'dead' = the token is no longer valid and should be deleted. */
async function sendToToken(token: string, data: Record<string, string>): Promise<SendOutcome> {
  const sa = serviceAccount();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getAccessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH', ttl: TTL } } }),
  });
  if (res.ok) return 'ok';
  let code = '';
  let message = '';
  try {
    const err = (await res.json()).error ?? {};
    message = String(err.message ?? '');
    code = (err.details ?? []).map((d: { errorCode?: string }) => d.errorCode).find(Boolean) ?? String(err.status ?? '');
  } catch {
    /* no JSON body */
  }
  if (code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH') return 'dead';
  if (code === 'INVALID_ARGUMENT' && /registration token/i.test(message)) return 'dead';
  console.error(`fcm send failed: ${res.status} ${code}`); // status/code only, never the token or message
  return 'failed';
}

/** Send to every phone linked to `userId`; deletes dead tokens. Returns how many phones got it. */
async function sendToRider(userId: string, data: Record<string, string>) {
  const { data: rows, error } = await admin.from('devices').select('token').eq('user_id', userId);
  if (error) throw new Error('devices_read_failed');
  const tokens = (rows ?? []).map((r) => r.token as string);
  const outcomes = await Promise.all(
    tokens.map((t) =>
      sendToToken(t, data).catch((e): SendOutcome => {
        console.error(`fcm send error: ${e instanceof Error ? e.message : 'unknown'}`); // never the token
        return 'failed';
      }),
    ),
  );
  const dead = tokens.filter((_, i) => outcomes[i] === 'dead');
  if (dead.length) await admin.from('devices').delete().in('token', dead);
  return { phones: tokens.length, delivered: outcomes.filter((o) => o === 'ok').length, dead: dead.length };
}

// ── Request ──

/** Plain single-line text, at most MAX_MESSAGE characters; null = too long. */
function cleanMessage(raw: unknown): string | null {
  if (raw === undefined || raw === null) return '';
  // Control characters and line/paragraph separators become spaces.
  const s = String(raw).replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).length > MAX_MESSAGE ? null : s;
}

interface Prepared {
  result: string;
  event_id: string | null;
  target: string | null;
  sender_username: string | null;
  retry_after: number | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user) return json({ error: 'not_logged_in' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const action = String(body.action ?? '');
  const uuid = /^[0-9a-f-]{36}$/i;

  // The database checks run as this rider (their own login), not with the service key.
  const asRider = createClient(SUPABASE_URL, ANON_KEY, { ...noSession, global: { headers: { Authorization: `Bearer ${jwt}` } } });

  let prepared: Prepared | undefined;
  let message = '';
  let replyCode = '';
  if (action === 'nudge' || action === 'alarm') {
    const receiver = String(body.receiver_id ?? '');
    const cleaned = cleanMessage(body.message);
    if (!uuid.test(receiver)) return json({ error: 'bad_request' }, 400);
    if (cleaned === null) return json({ error: 'message_too_long' }, 400);
    message = cleaned;
    const { data, error } = await asRider.rpc('prepare_nudge', { p_receiver: receiver, p_kind: action });
    if (error) return json({ error: /not_allowed/.test(error.message) ? 'not_allowed' : 'server_error' }, /not_allowed/.test(error.message) ? 403 : 500);
    prepared = data?.[0];
  } else if (action === 'reply') {
    const nudgeId = String(body.nudge_id ?? '');
    replyCode = String(body.code ?? '');
    if (!uuid.test(nudgeId) || !REPLY_LABELS[replyCode]) return json({ error: 'bad_request' }, 400);
    const { data, error } = await asRider.rpc('prepare_reply', { p_nudge: nudgeId, p_code: replyCode });
    if (error) return json({ error: /not_allowed/.test(error.message) ? 'not_allowed' : 'server_error' }, /not_allowed/.test(error.message) ? 403 : 500);
    prepared = data?.[0];
  } else {
    return json({ error: 'bad_request' }, 400);
  }

  if (!prepared) return json({ error: 'server_error' }, 500);
  switch (prepared.result) {
    case 'send':
      break;
    case 'suppressed': // muted or turned off: look exactly like a delivered nudge
      return json({ status: 'sent' });
    case 'no_device': // replies are also shown on the rider card, so they never report this
      return json({ status: action === 'reply' ? 'sent' : 'no_device' });
    case 'rate_limited':
      return json({ error: 'rate_limited', retry_after: prepared.retry_after ?? 60 }, 429);
    case 'not_allowed':
      return json({ error: 'not_allowed' }, 403);
    case 'expired':
    case 'already_replied':
    case 'bad_request':
      return json({ error: prepared.result }, 400);
    default:
      return json({ error: 'server_error' }, 500);
  }

  // Name shown to the receiver: username, or the full name for accounts without one.
  let name = prepared.sender_username ?? '';
  if (!name) {
    const { data: p } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
    name = (p?.full_name ?? '').trim() || 'A friend';
  }

  const payload: Record<string, unknown> = { screen: 'rider', rider_id: user.id, kind: action };
  let data: Record<string, string>;
  if (action === 'reply') {
    payload.reply_code = replyCode;
    data = { title: `${name} replied: ${REPLY_LABELS[replyCode]}`, message: '', channelId: 'nudges' };
  } else {
    payload.nudge_id = prepared.event_id;
    data =
      action === 'alarm'
        ? { title: `🚨 ${name} is calling you!`, message, channelId: 'ride-alarms', categoryId: 'ride-alarm' }
        : { title: `👋 ${name} nudged you`, message, channelId: 'nudges', categoryId: 'nudge' };
  }
  // `body` (a JSON string) becomes notification.request.content.data in the app; `tag` replaces a duplicate.
  data.body = JSON.stringify(payload);
  data.tag = String(prepared.event_id);

  try {
    const sent = await sendToRider(String(prepared.target), data);
    if (sent.delivered > 0) return json({ status: 'sent' });
    if (sent.phones === sent.dead) return json({ status: action === 'reply' ? 'sent' : 'no_device' });
    return json({ error: 'send_failed' }, 502);
  } catch (e) {
    console.error(`send-nudge failed: ${e instanceof Error ? e.message : 'unknown'}`);
    return json({ error: 'send_failed' }, 502);
  }
});
