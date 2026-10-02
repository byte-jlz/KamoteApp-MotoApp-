// Pure helpers for cloud sync (no network, no storage, no React), so they can be tested on their own.
//
// The phone's data is turned into "rows" that mirror the Supabase tables. Each row's content is hashed, and a
// small record per row ("stamp") remembers that hash and WHEN it last changed on this phone. Comparing stamps
// with what was last confirmed on the server tells us what to upload; comparing timestamps decides "newest wins"
// between phones. Photos, videos, albums, profile photos and club logos stay local and are never rows.
import type { Data } from './localData';
import type { Bike, BikeType, Club, MaintItem, OdometerReading, ServiceLog, Settings } from './types';

export type Table = 'profiles' | 'bikes' | 'maint_items' | 'odometer_readings' | 'service_logs' | 'clubs';
/** Apply/upload order: parents before children. */
export const TABLES: Table[] = ['profiles', 'bikes', 'maint_items', 'odometer_readings', 'service_logs', 'clubs'];

export type Payload = Record<string, unknown>;

/** A row as it exists on this phone right now. */
export interface Row {
  key: string;
  table: Table;
  payload: Payload;
}

/** A row from elsewhere (the server, or the guest data being merged in). */
export interface IncomingRow extends Row {
  deleted: boolean;
  /** When it was last changed on the phone that made it (client_updated_at). */
  t: string;
}

export interface Stamp {
  h: string; // content hash, or DELETED
  t: string; // when it last changed on this phone (ISO)
}

export interface Meta {
  /** False until the first look at this data. That look uses each record's own dates, not "now". */
  tracked: boolean;
  stamps: Record<string, Stamp>;
  /** Hash of each row as last confirmed on the server. A stamp that differs = an upload is pending. */
  synced: Record<string, string>;
  /** Server time of the newest change already pulled. */
  cursor: string | null;
  lastSyncedAt: string | null;
}

export const DELETED = 'deleted';
export const EPOCH = new Date(0).toISOString();

export function emptyMeta(): Meta {
  return { tracked: false, stamps: {}, synced: {}, cursor: null, lastSyncedAt: null };
}

// ── Small converters ──

export function iso(v: unknown): string {
  const d = new Date(typeof v === 'string' || typeof v === 'number' ? v : NaN);
  return isNaN(d.getTime()) ? EPOCH : d.toISOString();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined || v === '' ? null : num(v);
}

/** Text for the server, cut to the column's limit. */
function text(v: unknown, max: number): string {
  return String(v ?? '').slice(0, max);
}

function textOrNull(v: unknown, max: number): string | null {
  return v === null || v === undefined ? null : text(v, max);
}

function optional(v: unknown): string | undefined {
  return v === null || v === undefined ? undefined : String(v);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.slice(0, 100).map((x) => String(x)) : [];
}

// ── Keys ──

export const keys = {
  profile: 'profiles|me',
  bike: (id: string) => `bikes|${id}`,
  item: (bikeId: string, id: string) => `maint_items|${bikeId}|${id}`,
  reading: (bikeId: string, at: string) => `odometer_readings|${bikeId}|${at}`,
  log: (id: string) => `service_logs|${id}`,
  club: (id: string) => `clubs|${id}`,
};

// ── Local object → payload (the server's column names). Must be stable: same data → same payload. ──

function profilePayload(fullName: string, settings: Settings): Payload {
  return { full_name: text(fullName, 100), settings };
}

function bikePayload(b: Bike): Payload {
  return {
    id: b.id,
    name: text(b.name, 100),
    make: text(b.make, 100),
    model: text(b.model, 100),
    year: textOrNull(b.year, 20),
    plate: textOrNull(b.plate, 30),
    type: text(b.type, 30),
    odometer: num(b.odometer),
    created_at: iso(b.createdAt),
  };
}

function itemPayload(bikeId: string, i: MaintItem): Payload {
  return {
    bike_id: bikeId,
    id: i.id,
    key: text(i.key, 50),
    name: text(i.name, 100),
    description: textOrNull(i.description, 1000),
    interval_km: numOrNull(i.intervalKm),
    interval_months: numOrNull(i.intervalMonths),
    enabled: !!i.enabled,
    dismissed: !!i.dismissed,
    last_km: num(i.lastKm),
    last_date: iso(i.lastDate),
  };
}

function readingPayload(bikeId: string, r: OdometerReading): Payload {
  return { bike_id: bikeId, read_at: iso(r.date), km: num(r.km) };
}

function logPayload(l: ServiceLog): Payload {
  return {
    id: l.id,
    bike_id: l.bikeId,
    date: iso(l.date),
    km: num(l.km),
    item_ids: strings(l.itemIds),
    item_names: strings(l.itemNames).map((n) => n.slice(0, 100)),
    cost: numOrNull(l.cost),
    shop: textOrNull(l.shop, 200),
    notes: textOrNull(l.notes, 2000),
  };
}

function clubPayload(c: Club): Payload {
  return { id: c.id, name: text(c.name, 100), role: textOrNull(c.role, 100), since: textOrNull(c.since, 20) };
}

// ── Payload → local object ──

function bikeFields(p: Payload): Omit<Bike, 'items' | 'readings'> {
  return {
    id: String(p.id),
    name: String(p.name ?? ''),
    make: String(p.make ?? ''),
    model: String(p.model ?? ''),
    year: optional(p.year),
    plate: optional(p.plate),
    type: String(p.type ?? 'underbone') as BikeType,
    odometer: num(p.odometer),
    createdAt: iso(p.created_at),
  };
}

function itemFrom(p: Payload): MaintItem {
  return {
    id: String(p.id),
    key: String(p.key ?? 'custom'),
    name: String(p.name ?? ''),
    description: optional(p.description),
    intervalKm: numOrNull(p.interval_km),
    intervalMonths: numOrNull(p.interval_months),
    enabled: !!p.enabled,
    dismissed: !!p.dismissed,
    lastKm: num(p.last_km),
    lastDate: iso(p.last_date),
  };
}

function logFrom(p: Payload): ServiceLog {
  return {
    id: String(p.id),
    bikeId: String(p.bike_id),
    date: iso(p.date),
    km: num(p.km),
    itemIds: strings(p.item_ids),
    itemNames: strings(p.item_names),
    cost: numOrNull(p.cost),
    shop: optional(p.shop),
    notes: optional(p.notes),
  };
}

function clubFrom(p: Payload, logoFileName?: string): Club {
  return { id: String(p.id), name: String(p.name ?? ''), role: optional(p.role), since: optional(p.since), logoFileName };
}

/** Turn a server row into the same payload shape the phone produces, so hashes compare equal. */
export function fromServer(table: Table, raw: Payload): IncomingRow {
  const deleted = !!raw.deleted;
  const t = iso(raw.client_updated_at);
  switch (table) {
    case 'profiles': {
      const settings = raw.settings && typeof raw.settings === 'object' ? (raw.settings as Settings) : ({} as Settings);
      return { key: keys.profile, table, payload: profilePayload(String(raw.full_name ?? ''), settings), deleted: false, t };
    }
    case 'bikes': {
      const b = bikeFields(raw);
      return { key: keys.bike(b.id), table, payload: bikePayload({ ...b, items: [], readings: [] }), deleted, t };
    }
    case 'maint_items': {
      const bikeId = String(raw.bike_id);
      const i = itemFrom(raw);
      return { key: keys.item(bikeId, i.id), table, payload: itemPayload(bikeId, i), deleted, t };
    }
    case 'odometer_readings': {
      const bikeId = String(raw.bike_id);
      const r = { date: iso(raw.read_at), km: num(raw.km) };
      return { key: keys.reading(bikeId, r.date), table, payload: readingPayload(bikeId, r), deleted, t };
    }
    case 'service_logs': {
      const l = logFrom(raw);
      return { key: keys.log(l.id), table, payload: logPayload(l), deleted, t };
    }
    case 'clubs': {
      const c = clubFrom(raw);
      return { key: keys.club(c.id), table, payload: clubPayload(c), deleted, t };
    }
  }
}

// ── Data → rows ──

export function toRows(data: Data): Map<string, Row> {
  const rows = new Map<string, Row>();
  const add = (key: string, table: Table, payload: Payload) => rows.set(key, { key, table, payload });
  add(keys.profile, 'profiles', profilePayload(data.profile.fullName, data.settings));
  for (const b of data.bikes) {
    add(keys.bike(b.id), 'bikes', bikePayload(b));
    for (const i of b.items) add(keys.item(b.id, i.id), 'maint_items', itemPayload(b.id, i));
    for (const r of b.readings) {
      const p = readingPayload(b.id, r);
      add(keys.reading(b.id, String(p.read_at)), 'odometer_readings', p);
    }
  }
  for (const l of data.logs) add(keys.log(l.id), 'service_logs', logPayload(l));
  for (const c of data.clubs) add(keys.club(c.id), 'clubs', clubPayload(c));
  return rows;
}

// ── Hashing (stable: object keys are sorted, so jsonb key order from the server doesn't matter) ──

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object)
      .sort()
      .filter((k) => (v as Payload)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((v as Payload)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

function fnv(s: string, seed: number) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function hashPayload(p: Payload) {
  const s = stable(p);
  return `${fnv(s, 2166136261).toString(36)}${fnv(s, 0x9747b28c).toString(36)}${s.length.toString(36)}`;
}

// ── Change tracking ──

/**
 * When a record is first seen in data that existed before sync, use its own date instead of "now", so an old
 * guest record doesn't beat a newer edit from another phone when merging.
 */
function firstSeenTimes(rows: Map<string, Row>): Map<string, string> {
  const out = new Map<string, string>();
  const latestForBike = new Map<string, string>();
  const bump = (bikeId: string, t: string) => {
    const cur = latestForBike.get(bikeId);
    if (!cur || t > cur) latestForBike.set(bikeId, t);
  };
  for (const r of rows.values()) {
    const p = r.payload;
    if (r.table === 'maint_items') {
      out.set(r.key, String(p.last_date));
      bump(String(p.bike_id), String(p.last_date));
    } else if (r.table === 'odometer_readings') {
      out.set(r.key, String(p.read_at));
      bump(String(p.bike_id), String(p.read_at));
    } else if (r.table === 'service_logs') {
      out.set(r.key, String(p.date));
    } else if (r.table === 'bikes') {
      bump(String(p.id), String(p.created_at));
    } else {
      out.set(r.key, EPOCH);
    }
  }
  for (const r of rows.values()) {
    if (r.table === 'bikes') out.set(r.key, latestForBike.get(String(r.payload.id)) ?? EPOCH);
  }
  return out;
}

/**
 * Compare the data with the stamps and record what changed (and when). Deleted records keep a "tombstone"
 * stamp until the server has the deletion; guests have no server, so their tombstones are dropped right away.
 */
export function track(meta: Meta, data: Data, opts: { keepTombstones: boolean; now?: string }): { meta: Meta; changed: boolean } {
  const now = opts.now ?? new Date().toISOString();
  const rows = toRows(data);
  const stamps = { ...meta.stamps };
  const synced = { ...meta.synced };
  let changed = false;
  const firstSeen = meta.tracked ? null : firstSeenTimes(rows);

  for (const row of rows.values()) {
    const h = hashPayload(row.payload);
    const s = stamps[row.key];
    if (s && s.h === h) continue;
    stamps[row.key] = { h, t: firstSeen?.get(row.key) ?? now };
    changed = true;
  }
  for (const [key, s] of Object.entries(stamps)) {
    if (rows.has(key)) continue;
    if (s.h !== DELETED) {
      if (opts.keepTombstones) stamps[key] = { h: DELETED, t: now };
      else delete stamps[key];
      changed = true;
    } else if (!opts.keepTombstones || synced[key] === DELETED) {
      delete stamps[key]; // the server already has this deletion
      delete synced[key];
    }
  }
  return { meta: { ...meta, tracked: true, stamps, synced }, changed };
}

/** Keys with a change that isn't on the server yet. */
export function pendingKeys(meta: Meta) {
  return Object.keys(meta.stamps).filter((k) => meta.stamps[k].h !== meta.synced[k]);
}

// ── Applying rows from elsewhere ──

/**
 * Apply incoming rows to the data. Returns media file names that are no longer used (photos of a bike that was
 * deleted on another phone, a deleted club's logo) so the caller can delete the files.
 */
export function applyRows(data: Data, incoming: IncomingRow[]): { data: Data; removedMedia: string[] } {
  if (!incoming.length) return { data, removedMedia: [] };
  const removed: (string | undefined)[] = [];
  const bikes = data.bikes.map((b) => ({ ...b, items: [...b.items], readings: [...b.readings] }));
  let { logs, photos, clubs, profile, settings } = data;
  let logsChanged = false;

  const rows = [...incoming].sort((a, b) => TABLES.indexOf(a.table) - TABLES.indexOf(b.table));
  for (const r of rows) {
    const p = r.payload;
    switch (r.table) {
      case 'profiles': {
        // Keep what's on the phone where the other side is empty (e.g. a brand-new account has no settings yet).
        const name = String(p.full_name ?? '');
        profile = { ...profile, fullName: name || profile.fullName };
        settings = { ...settings, ...((p.settings as Partial<Settings>) ?? {}) };
        break;
      }
      case 'bikes': {
        const id = String(p.id);
        const i = bikes.findIndex((b) => b.id === id);
        if (r.deleted) {
          if (i < 0) break;
          bikes.splice(i, 1);
          logs = logs.filter((l) => l.bikeId !== id);
          logsChanged = true;
          for (const ph of photos) if (ph.bikeId === id) removed.push(ph.fileName, ph.thumbFileName);
          photos = photos.filter((ph) => ph.bikeId !== id);
        } else if (i >= 0) {
          bikes[i] = { ...bikes[i], ...bikeFields(p) };
        } else {
          bikes.push({ ...bikeFields(p), items: [], readings: [] });
        }
        break;
      }
      case 'maint_items': {
        const bike = bikes.find((b) => b.id === String(p.bike_id));
        if (!bike) break;
        const i = bike.items.findIndex((x) => x.id === String(p.id));
        if (r.deleted) {
          if (i >= 0) bike.items.splice(i, 1);
        } else if (i >= 0) bike.items[i] = itemFrom(p);
        else bike.items.push(itemFrom(p));
        break;
      }
      case 'odometer_readings': {
        const bike = bikes.find((b) => b.id === String(p.bike_id));
        if (!bike) break;
        const at = iso(p.read_at);
        const i = bike.readings.findIndex((x) => iso(x.date) === at);
        if (r.deleted) {
          if (i >= 0) bike.readings.splice(i, 1);
        } else if (i >= 0) bike.readings[i] = { date: at, km: num(p.km) };
        else bike.readings.push({ date: at, km: num(p.km) });
        break;
      }
      case 'service_logs': {
        const id = String(p.id);
        logsChanged = true;
        if (r.deleted) logs = logs.filter((l) => l.id !== id);
        else if (logs.some((l) => l.id === id)) logs = logs.map((l) => (l.id === id ? logFrom(p) : l));
        else logs = [...logs, logFrom(p)];
        break;
      }
      case 'clubs': {
        const id = String(p.id);
        const prev = clubs.find((c) => c.id === id);
        if (r.deleted) {
          if (!prev) break;
          removed.push(prev.logoFileName);
          clubs = clubs.filter((c) => c.id !== id);
        } else if (prev) clubs = clubs.map((c) => (c.id === id ? clubFrom(p, prev.logoFileName) : c));
        else clubs = [...clubs, clubFrom(p)];
        break;
      }
    }
  }

  for (const b of bikes) b.readings.sort((a, c) => iso(a.date).localeCompare(iso(c.date)));
  if (logsChanged) logs = [...logs].sort((a, b) => iso(b.date).localeCompare(iso(a.date)));
  return {
    data: { ...data, bikes, logs, photos, clubs, profile, settings },
    removedMedia: removed.filter((f): f is string => !!f),
  };
}

/**
 * The payload the phone will have after applying `row`. Same as the row, except the profile, which keeps the
 * phone's name/settings where the server has none (so a new phone doesn't wipe settings on the others).
 */
export function payloadAfterApply(data: Data, row: IncomingRow): Payload {
  if (row.table !== 'profiles') return row.payload;
  const p = row.payload;
  const settings = { ...data.settings, ...((p.settings as Partial<Settings>) ?? {}) };
  return profilePayload(String(p.full_name ?? '') || data.profile.fullName, settings);
}

// ── Merging two sets of phone data (guest → account on login, account → guest on "keep a copy") ──

/**
 * Merge `source` into `target` by record id. Records only on one side are kept; where both have a record, the
 * newer change wins (ties keep the target). Merged-in records count as changes in the target, so they upload.
 * Photos, albums, profile photo and club logos (phone-only) are carried over too.
 */
export function mergeInto(
  target: { data: Data; meta: Meta },
  source: { data: Data; meta: Meta },
  opts: { keepTombstones: boolean },
): { data: Data; meta: Meta } {
  const t = track(target.meta, target.data, opts).meta;
  const s = track(source.meta, source.data, { keepTombstones: false }).meta;
  const accept: IncomingRow[] = [];
  const stamps = { ...t.stamps };

  for (const [key, row] of toRows(source.data)) {
    const sStamp = s.stamps[key];
    const tStamp = stamps[key];
    if (tStamp) {
      if (tStamp.h === sStamp.h) continue; // same content
      if (tStamp.t > sStamp.t) continue; // target's change (or deletion) is newer
      // A tie keeps the target, except for the profile: both sides' "never edited" date is the same, and a fresh
      // copy's default settings shouldn't beat the rider's real ones. (A name from the server still wins on sync.)
      if (tStamp.t === sStamp.t && key !== keys.profile) continue;
    }
    accept.push({ ...row, deleted: false, t: sStamp.t });
    stamps[key] = { ...sStamp };
  }

  const applied = applyRows(target.data, accept);
  const d = applied.data;
  const src = source.data;

  // Phone-only things.
  const bikeIds = new Set(d.bikes.map((b) => b.id));
  const photoIds = new Set(d.photos.map((p) => p.id));
  const albumIds = new Set(d.albums.map((a) => a.id));
  const data: Data = {
    ...d,
    photos: [...d.photos, ...src.photos.filter((p) => !photoIds.has(p.id) && bikeIds.has(p.bikeId))],
    albums: [...d.albums, ...src.albums.filter((a) => !albumIds.has(a.id))],
    profile: { ...d.profile, photoFileName: d.profile.photoFileName ?? src.profile.photoFileName },
    clubs: d.clubs.map((c) => (c.logoFileName ? c : { ...c, logoFileName: src.clubs.find((x) => x.id === c.id)?.logoFileName })),
  };
  return { data, meta: { ...t, stamps } };
}

// ── Misc ──

/** Anything worth asking about before merging or clearing? */
export function hasContent(data: Data) {
  return data.bikes.length > 0 || data.logs.length > 0 || data.clubs.length > 0 || data.photos.length > 0 || !!data.profile.fullName.trim();
}

/** Every media file the data points at (photos, video thumbnails, profile photo, club logos). */
export function mediaFiles(data: Data): string[] {
  const files = [
    ...data.photos.flatMap((p) => [p.fileName, p.thumbFileName]),
    data.profile.photoFileName,
    ...data.clubs.map((c) => c.logoFileName),
  ];
  return files.filter((f): f is string => !!f);
}
