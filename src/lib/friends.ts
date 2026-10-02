import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';

// Friends and online status. Everything goes through database functions (supabase/migrations/…006 and …007):
// the server decides who can be found, who is a friend, and what status a friend sees.

export type OnlineStatus = 'online' | 'recent' | 'offline';
/** How a rider relates to me. 'friends' is used on rider cards; list rows say 'friend'. */
export type Relation = 'self' | 'friends' | 'outgoing' | 'incoming' | 'none';

export interface FriendRow {
  id: string;
  username: string | null;
  fullName: string;
  relation: 'friend' | 'incoming' | 'outgoing';
  status: OnlineStatus | null;
  minutesAgo: number | null;
  since: string;
}

export interface Rider {
  id: string;
  username: string | null;
  fullName: string;
  relation: Relation;
  status?: OnlineStatus | null;
  minutesAgo?: number | null;
  /** Found by a Quick add code: adding makes you friends straight away. */
  quick?: boolean;
}

export type FriendError = 'network' | 'rate_limited' | 'not_allowed' | 'unknown';
export type Result<T> = { ok: true; data: T } | { ok: false; error: FriendError };
/** What the server says after an action. */
export type ActionResult =
  | 'requested'
  | 'accepted'
  | 'already_requested'
  | 'already_friends'
  | 'declined'
  | 'ok'
  | 'rate_limited'
  | 'not_found';

function isNetwork(message: string) {
  return /network|fetch|timed? ?out|failed to connect/i.test(message);
}

export async function rpc<T>(fn: string, args?: object): Promise<Result<T>> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (!error) return { ok: true, data: data as T };
    const msg = error.message ?? '';
    if (/rate_limited/.test(msg)) return { ok: false, error: 'rate_limited' };
    if (/not_allowed/.test(msg)) return { ok: false, error: 'not_allowed' };
    if (isNetwork(msg)) return { ok: false, error: 'network' };
    console.warn(`${fn} failed`, error);
    return { ok: false, error: 'unknown' };
  } catch (e) {
    return { ok: false, error: isNetwork(String(e)) ? 'network' : 'unknown' };
  }
}

export function errorText(e: FriendError) {
  switch (e) {
    case 'network':
      return 'No internet connection. Try again when you’re online.';
    case 'rate_limited':
      return 'Too many tries. Please wait a while and try again.';
    case 'not_allowed':
      return 'Your account can’t use friends right now.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/** Friendly message for an action result (null when it simply worked). */
export function actionText(r: ActionResult): string | null {
  switch (r) {
    case 'requested':
      return 'Friend request sent.';
    case 'accepted':
      return 'You’re now friends.';
    case 'already_requested':
      return 'You already sent a request.';
    case 'already_friends':
      return 'You’re already friends.';
    case 'rate_limited':
      return 'You’ve sent a lot of friend requests today. Try again tomorrow.';
    case 'not_found':
      return 'Rider not found.';
    default:
      return null;
  }
}

/** "Online", "Active 15m ago", "Active 3h ago" or "Offline". */
export function statusText(status: OnlineStatus | null | undefined, minutesAgo: number | null | undefined) {
  if (status === 'online') return 'Online';
  if (status === 'recent' && minutesAgo) {
    return minutesAgo < 60 ? `Active ${minutesAgo}m ago` : `Active ${Math.floor(minutesAgo / 60)}h ago`;
  }
  return 'Offline';
}

export function displayName(r: { fullName: string; username: string | null }) {
  return r.fullName.trim() || (r.username ? `@${r.username}` : 'Rider');
}

type RiderRow = { id: string; username: string | null; full_name: string; relation: Relation; status?: OnlineStatus | null; minutes_ago?: number | null; quick?: boolean };

const toRider = (r: RiderRow): Rider => ({
  id: r.id,
  username: r.username,
  fullName: r.full_name ?? '',
  relation: r.relation,
  status: r.status,
  minutesAgo: r.minutes_ago,
  quick: r.quick,
});

async function riderQuery(fn: string, args: object): Promise<Result<Rider | null>> {
  const r = await rpc<RiderRow[]>(fn, args);
  return r.ok ? { ok: true, data: r.data?.[0] ? toRider(r.data[0]) : null } : r;
}

export const api = {
  heartbeat: () => rpc<number>('heartbeat'),
  findRider: (username: string) => riderQuery('find_rider', { p_username: username.trim().toLowerCase() }),
  getRider: (id: string) => riderQuery('get_rider', { p_id: id }),
  findByCode: (code: string) => riderQuery('find_rider_by_code', { p_code: code }),
  send: (id: string) => rpc<ActionResult>('send_friend_request', { p_id: id }),
  addByCode: (code: string) => rpc<ActionResult>('add_friend_by_code', { p_code: code }),
  cancel: (id: string) => rpc<ActionResult>('cancel_friend_request', { p_id: id }),
  respond: (id: string, accept: boolean) => rpc<ActionResult>('respond_friend_request', { p_id: id, p_accept: accept }),
  unfriend: (id: string) => rpc<ActionResult>('unfriend', { p_id: id }),
  block: (id: string) => rpc<ActionResult>('block_rider', { p_id: id }),
  unblock: (id: string) => rpc<ActionResult>('unblock_rider', { p_id: id }),
  listBlocked: async (): Promise<Result<Rider[]>> => {
    const r = await rpc<RiderRow[]>('list_blocked');
    return r.ok ? { ok: true, data: (r.data ?? []).map((x) => toRider({ ...x, relation: 'none' })) } : r;
  },
  getShowOnline: async (): Promise<Result<boolean>> => {
    const r = await rpc<{ show_online: boolean }[]>('get_social_settings');
    return r.ok ? { ok: true, data: r.data?.[0]?.show_online ?? true } : r;
  },
  setShowOnline: (show: boolean) => rpc<null>('set_show_online', { p_show: show }),
  myCode: () => rpc<string>('my_friend_code'),
  resetCode: () => rpc<string>('reset_friend_code'),
  createQuickCode: async (): Promise<Result<{ code: string; expiresAt: string }>> => {
    const r = await rpc<{ code: string; expires_at: string }[]>('create_quick_add_code');
    if (!r.ok) return r;
    const row = r.data?.[0];
    return row ? { ok: true, data: { code: row.code, expiresAt: row.expires_at } } : { ok: false, error: 'unknown' };
  },
  cancelQuickCode: () => rpc<null>('cancel_quick_add_code'),
};

// ── Shared friends list (Friends tab, requests screen, tab badge) ──
// Kept per account and cached on the phone, so the last list still shows when offline.

export interface FriendsState {
  userId: string | null;
  rows: FriendRow[];
  /** When the list was last loaded from the server (ISO), or null if never. */
  loadedAt: string | null;
  loading: boolean;
  /** The last refresh failed for lack of internet; the list shown may be out of date. */
  offline: boolean;
  /** Incoming requests, for the tab badge (from the list, or from the heartbeat). */
  incoming: number;
}

const EMPTY_STATE: FriendsState = { userId: null, rows: [], loadedAt: null, loading: false, offline: false, incoming: 0 };
let state = EMPTY_STATE;
const listeners = new Set<() => void>();

function setState(patch: Partial<FriendsState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const cacheKey = (userId: string) => `motopms:friends:v1:${userId}`;

/** Switch the shared list to this account (or none), loading its cached copy. */
export async function attachFriends(userId: string | null) {
  if (state.userId === userId) return;
  state = { ...EMPTY_STATE, userId };
  listeners.forEach((l) => l());
  if (!userId) return;
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId));
    if (raw && state.userId === userId && !state.loadedAt) {
      const cached = JSON.parse(raw) as { rows: FriendRow[]; loadedAt: string };
      setState({ rows: cached.rows, loadedAt: cached.loadedAt, incoming: countIncoming(cached.rows) });
    }
  } catch (e) {
    console.warn('Failed to read friends cache', e);
  }
}

const countIncoming = (rows: FriendRow[]) => rows.filter((r) => r.relation === 'incoming').length;

type ListRow = { id: string; username: string | null; full_name: string; relation: FriendRow['relation']; status: OnlineStatus | null; minutes_ago: number | null; since: string };

/** Reload the list from the server. Returns the error, if any. */
export async function refreshFriends(): Promise<FriendError | null> {
  const userId = state.userId;
  if (!userId) return null;
  setState({ loading: true });
  const r = await rpc<ListRow[]>('list_friends');
  if (state.userId !== userId) return null; // switched account meanwhile
  if (!r.ok) {
    setState({ loading: false, offline: r.error === 'network' });
    return r.error;
  }
  const rows: FriendRow[] = (r.data ?? []).map((x) => ({
    id: x.id,
    username: x.username,
    fullName: x.full_name ?? '',
    relation: x.relation,
    status: x.status,
    minutesAgo: x.minutes_ago,
    since: x.since,
  }));
  const loadedAt = new Date().toISOString();
  setState({ rows, loadedAt, loading: false, offline: false, incoming: countIncoming(rows) });
  AsyncStorage.setItem(cacheKey(userId), JSON.stringify({ rows, loadedAt })).catch(() => {});
  return null;
}

/** The heartbeat reports incoming requests; keep the badge current between list refreshes. */
export function setIncomingCount(n: number) {
  if (state.userId && n !== state.incoming) setState({ incoming: n });
}

/** After a network failure anywhere in Friends, show the offline notice. */
export function markOffline(offline: boolean) {
  if (state.offline !== offline) setState({ offline });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useFriends() {
  return useSyncExternalStore(subscribe, () => state);
}

/** Run an action; network failures flip the offline notice and the list is refreshed afterwards. */
export async function runAction(fn: () => Promise<Result<ActionResult>>): Promise<Result<ActionResult>> {
  const r = await fn();
  if (!r.ok && r.error === 'network') markOffline(true);
  if (r.ok) refreshFriends();
  return r;
}

// ── Deep link waiting for login ──

const PENDING_KEY = 'motopms:pendingFriendCode';

export function savePendingCode(code: string) {
  return AsyncStorage.setItem(PENDING_KEY, code).catch(() => {});
}

/** Returns and forgets a friend code opened before logging in. */
export async function takePendingCode() {
  try {
    const code = await AsyncStorage.getItem(PENDING_KEY);
    if (code) await AsyncStorage.removeItem(PENDING_KEY);
    return code;
  } catch {
    return null;
  }
}
