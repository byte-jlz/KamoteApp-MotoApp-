// Cloud sync for logged-in riders. The phone (AsyncStorage) stays the source the app reads from; this module
// uploads local changes and downloads changes made on the rider's other phones, whenever there's internet.
//
//   pull: rows changed on the server since the last pull → apply the ones that are newer than this phone's copy
//   push: rows changed on this phone and not yet on the server → upsert (the database keeps whichever is newest)
//
// Also: moving data between the guest copy and an account copy on login/logout.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { Data, dataKeyFor, GUEST_KEY, readData } from './localData';
import { deleteMediaFile } from './photos';
import { supabase } from './supabase';
import {
  applyRows,
  DELETED,
  emptyMeta,
  fromServer,
  hashPayload,
  hasContent,
  IncomingRow,
  mediaFiles,
  mergeInto,
  Meta,
  payloadAfterApply,
  pendingKeys,
  Table,
  TABLES,
  toRows,
  track,
} from './syncData';

const PAGE = 1000; // Supabase returns at most 1000 rows per request
const PUSH_CHUNK = 500;
const OVERLAP_MS = 2 * 60 * 1000; // re-read a little before the last pull, in case a save landed late
const CHANGE_DELAY_MS = 3000;

type DataTable = Exclude<Table, 'profiles'>;
const CONFLICT_COLUMNS: Record<DataTable, string> = {
  bikes: 'user_id,id',
  maint_items: 'user_id,bike_id,id',
  odometer_readings: 'user_id,bike_id,read_at',
  service_logs: 'user_id,id',
  clubs: 'user_id,id',
};

// ── Sync bookkeeping, one per storage key, cached in memory so the tracker and the engine share it ──

const metaKey = (storageKey: string) => `${storageKey}:sync`;
const metas = new Map<string, Meta>();

async function loadMeta(storageKey: string): Promise<Meta> {
  const cached = metas.get(storageKey);
  if (cached) return cached;
  let meta = emptyMeta();
  try {
    const raw = await AsyncStorage.getItem(metaKey(storageKey));
    if (raw) meta = { ...emptyMeta(), ...(JSON.parse(raw) as Partial<Meta>) };
  } catch (e) {
    console.warn('Failed to load sync state', e);
  }
  // Another caller may have loaded it while we were reading.
  const existing = metas.get(storageKey);
  if (existing) return existing;
  metas.set(storageKey, meta);
  return meta;
}

/** Change the bookkeeping in one synchronous step (so the tracker and a running sync can't overwrite each other). */
function updateMeta(storageKey: string, fn: (m: Meta) => Meta) {
  const next = fn(metas.get(storageKey) ?? emptyMeta());
  metas.set(storageKey, next);
  AsyncStorage.setItem(metaKey(storageKey), JSON.stringify(next)).catch((e) => console.warn('Failed to save sync state', e));
  return next;
}

async function removeLocal(storageKey: string) {
  metas.delete(storageKey);
  await AsyncStorage.multiRemove([storageKey, metaKey(storageKey)]);
}

// ── Status for the UI ──

export interface SyncState {
  status: 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt: string | null;
  /** Local changes not on the server yet. */
  pending: number;
}

let state: SyncState = { status: 'idle', lastSyncedAt: null, pending: 0 };
const listeners = new Set<() => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeSync(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncState() {
  return state;
}

// ── Change tracking (called by the store after every save, for guests too) ──

/** Record what changed in the saved data. Guests have no server, so they keep no deletion records. */
export async function trackSaved(storageKey: string, data: Data) {
  await loadMeta(storageKey);
  let changed = false;
  const meta = updateMeta(storageKey, (m) => {
    const r = track(m, data, { keepTombstones: storageKey !== GUEST_KEY });
    changed = r.changed;
    return r.meta;
  });
  if (runner?.storageKey === storageKey) {
    setState({ pending: pendingKeys(meta).length });
    if (changed) requestSync(CHANGE_DELAY_MS);
  }
}

// ── The running sync (attached by the app while a rider is logged in) ──

interface Runner {
  userId: string;
  storageKey: string;
  /** The data the app currently shows. */
  getData: () => Data;
  /** Apply a change to the app's data (and delete media files that are no longer used). */
  apply: (fn: (d: Data) => { data: Data; removedMedia: string[] }) => void;
}

let runner: Runner | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;

export function attachSync(r: Runner) {
  runner = r;
  loadMeta(r.storageKey).then((m) => {
    if (runner === r) setState({ status: 'idle', lastSyncedAt: m.lastSyncedAt, pending: pendingKeys(m).length });
  });
  requestSync(0);
  const sub = AppState.addEventListener('change', (s) => s === 'active' && requestSync(0));
  return () => {
    sub.remove();
    if (runner === r) stopSync();
  };
}

/** Stop syncing (logging out). */
export function stopSync() {
  runner = null;
  if (timer) clearTimeout(timer);
  timer = null;
}

export function requestSync(delayMs = 0) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncNow();
  }, delayMs);
}

/** Sync now; if a sync is already running, run once more after it. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce();
    } while (again && runner);
  })().finally(() => {
    running = null;
  });
  return running;
}

function isNetworkError(e: unknown) {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e ? String((e as { message?: unknown }).message) : String(e);
  return /network|fetch|timed? ?out|failed to connect/i.test(msg);
}

function newer(a: string | null, b: unknown) {
  if (typeof b !== 'string') return a;
  return !a || new Date(b).getTime() > new Date(a).getTime() ? b : a;
}

async function pull(r: Runner, since: string | null) {
  const incoming: IncomingRow[] = [];
  let newest: string | null = null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('full_name, settings, client_updated_at, updated_at')
    .eq('id', r.userId)
    .maybeSingle();
  if (error) throw error;
  if (profile) incoming.push(fromServer('profiles', profile));

  for (const table of TABLES) {
    if (table === 'profiles') continue;
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from(table).select('*').eq('user_id', r.userId);
      if (since) q = q.gte('updated_at', since);
      const { data, error: e } = await q.order('updated_at', { ascending: true }).range(from, from + PAGE - 1);
      if (e) throw e;
      for (const raw of data) {
        incoming.push(fromServer(table, raw));
        newest = newer(newest, raw.updated_at);
      }
      if (data.length < PAGE) break;
    }
  }
  return { incoming, newest };
}

/** Push one key's deletion. The key format comes from syncData `keys`. */
function deletionFilter(key: string, userId: string) {
  const [table, a, b] = key.split('|') as [DataTable, string, string?];
  if (table === 'maint_items') return { table, match: { user_id: userId, bike_id: a, id: b! } };
  if (table === 'odometer_readings') return { table, match: { user_id: userId, bike_id: a, read_at: b! } };
  return { table, match: { user_id: userId, id: a } };
}

/**
 * Upload pending rows from `data` (the data as it is after this sync's downloads were applied).
 * A row whose content no longer matches its stamp was edited just now; the tracker will stamp it and it goes next time.
 */
async function push(r: Runner, data: Data) {
  const meta = metas.get(r.storageKey) ?? emptyMeta();
  const rows = toRows(data);
  const upserts = new Map<DataTable, { key: string; h: string; body: Record<string, unknown> }[]>();
  const done: Record<string, string> = {};

  for (const key of pendingKeys(meta)) {
    const stamp = meta.stamps[key];
    if (stamp.h === DELETED) {
      if (key.startsWith('profiles|')) continue;
      const { table, match } = deletionFilter(key, r.userId);
      // Harmless if the server never had it (no row matches).
      const { error } = await supabase.from(table).update({ deleted: true, client_updated_at: stamp.t }).match(match);
      if (error) throw error;
      done[key] = DELETED;
      continue;
    }
    const row = rows.get(key);
    if (!row || hashPayload(row.payload) !== stamp.h) continue;
    if (row.table === 'profiles') {
      const { error } = await supabase
        .from('profiles')
        .update({ ...row.payload, client_updated_at: stamp.t })
        .eq('id', r.userId);
      if (error) throw error;
      done[key] = stamp.h;
      continue;
    }
    const list = upserts.get(row.table) ?? [];
    list.push({ key, h: stamp.h, body: { ...row.payload, user_id: r.userId, client_updated_at: stamp.t, deleted: false } });
    upserts.set(row.table, list);
  }

  for (const table of TABLES) {
    if (table === 'profiles') continue;
    const list = upserts.get(table) ?? [];
    for (let i = 0; i < list.length; i += PUSH_CHUNK) {
      const chunk = list.slice(i, i + PUSH_CHUNK);
      const { error } = await supabase.from(table).upsert(
        chunk.map((c) => c.body),
        { onConflict: CONFLICT_COLUMNS[table] },
      );
      if (error) throw error;
      for (const c of chunk) done[c.key] = c.h;
    }
  }

  updateMeta(r.storageKey, (m) => ({ ...m, synced: { ...m.synced, ...done } }));
}

async function syncOnce() {
  const r = runner;
  if (!r) return;
  setState({ status: 'syncing' });
  try {
    const before = await loadMeta(r.storageKey);
    // Stamp anything not tracked yet, so a local edit can't be mistaken for "missing" and overwritten.
    updateMeta(r.storageKey, (m) => track(m, r.getData(), { keepTombstones: true }).meta);

    const since = before.cursor ? new Date(new Date(before.cursor).getTime() - OVERLAP_MS).toISOString() : null;
    const { incoming, newest } = await pull(r, since);
    if (runner !== r) return;

    // Decide, row by row, whether the server's copy should replace this phone's.
    const current = r.getData();
    const accepted: IncomingRow[] = [];
    updateMeta(r.storageKey, (m) => {
      const stamps = { ...m.stamps };
      const synced = { ...m.synced };
      for (const row of incoming) {
        const remoteHash = row.deleted ? DELETED : hashPayload(row.payload);
        const s = stamps[row.key];
        if (s && s.h === remoteHash) {
          synced[row.key] = remoteHash; // already the same
          continue;
        }
        if (!s && row.deleted) continue; // deleted somewhere, never on this phone
        const localPending = !!s && s.h !== synced[row.key];
        if (localPending && s.t > row.t) continue; // this phone's change is newer; it uploads below
        accepted.push(row);
        const after = row.deleted ? DELETED : hashPayload(payloadAfterApply(current, row));
        stamps[row.key] = { h: after, t: row.t };
        synced[row.key] = remoteHash;
      }
      return { ...m, stamps, synced };
    });
    if (accepted.length) r.apply((d) => applyRows(d, accepted));

    await push(r, accepted.length ? applyRows(current, accepted).data : current);
    if (runner !== r) return;

    const meta = updateMeta(r.storageKey, (m) => ({
      ...m,
      cursor: newer(m.cursor, newest),
      lastSyncedAt: new Date().toISOString(),
    }));
    setState({ status: 'idle', lastSyncedAt: meta.lastSyncedAt, pending: pendingKeys(meta).length });
  } catch (e) {
    if (runner !== r) return;
    const meta = metas.get(r.storageKey);
    if (!isNetworkError(e)) console.warn('Sync failed', e);
    setState({ status: isNetworkError(e) ? 'offline' : 'error', pending: meta ? pendingKeys(meta).length : state.pending });
  }
}

// ── Moving data on login / logout ──

/** Bikes, service logs and photos in the guest copy on this phone (to decide whether to ask about uploading). */
export async function guestSummary() {
  const g = await readData(GUEST_KEY);
  return { hasData: hasContent(g), bikes: g.bikes.length, logs: g.logs.length, photos: g.photos.length };
}

/** Login "Upload": merge the guest data into the account's copy on this phone, then remove the guest copy. */
export async function moveGuestIntoAccount(userId: string) {
  const accountKey = dataKeyFor(userId);
  const [guest, account, guestMeta, accountMeta] = await Promise.all([
    readData(GUEST_KEY),
    readData(accountKey),
    loadMeta(GUEST_KEY),
    loadMeta(accountKey),
  ]);
  const merged = mergeInto({ data: account, meta: accountMeta }, { data: guest, meta: guestMeta }, { keepTombstones: true });
  await AsyncStorage.setItem(accountKey, JSON.stringify(merged.data));
  updateMeta(accountKey, () => merged.meta);
  await removeLocal(GUEST_KEY);
}

/** Logout "Keep a copy": merge the account's copy into the guest data, then remove the account copy. */
export async function moveAccountToGuest(userId: string) {
  const accountKey = dataKeyFor(userId);
  const [guest, account, guestMeta, accountMeta] = await Promise.all([
    readData(GUEST_KEY),
    readData(accountKey),
    loadMeta(GUEST_KEY),
    loadMeta(accountKey),
  ]);
  const merged = mergeInto({ data: guest, meta: guestMeta }, { data: account, meta: accountMeta }, { keepTombstones: false });
  await AsyncStorage.setItem(GUEST_KEY, JSON.stringify(merged.data));
  updateMeta(GUEST_KEY, () => merged.meta);
  await removeLocal(accountKey);
}

/** Logout "Remove": delete the account's copy and its photos/videos from this phone (guest data is untouched). */
export async function clearAccountData(userId: string) {
  const accountKey = dataKeyFor(userId);
  const [guest, account] = await Promise.all([readData(GUEST_KEY), readData(accountKey)]);
  const stillUsed = new Set(mediaFiles(guest));
  for (const f of mediaFiles(account)) if (!stillUsed.has(f)) deleteMediaFile(f);
  await removeLocal(accountKey);
}

/** How many photos/videos the account's copy on this phone has (for the logout warning). */
export async function accountMediaCount(userId: string) {
  return (await readData(dataKeyFor(userId))).photos.length;
}
