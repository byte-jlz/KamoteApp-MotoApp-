// A tiny in-memory stand-in for Supabase's REST API with the same "newest wins" rule as sync_guard().
const S = (globalThis.__server ??= { tables: new Map(), clock: Date.parse('2030-01-01T00:00:00Z'), offline: false, writes: 0, uid: 'u1' });
const PK = {
  profiles: ['id'], bikes: ['user_id', 'id'], maint_items: ['user_id', 'bike_id', 'id'],
  odometer_readings: ['user_id', 'bike_id', 'read_at'], service_logs: ['user_id', 'id'], clubs: ['user_id', 'id'],
};
const TS = new Set(['created_at', 'last_date', 'read_at', 'date', 'client_updated_at', 'updated_at']);
const norm = (c, v) => (TS.has(c) && typeof v === 'string' ? new Date(v).toISOString() : v);
const out = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, TS.has(k) && typeof v === 'string' ? v.replace('Z', '+00:00') : v]));
const tbl = (t) => (S.tables.has(t) || S.tables.set(t, new Map()), S.tables.get(t));
const pkOf = (t, r) => PK[t].map((c) => String(norm(c, r[c]))).join('|');
const now = () => new Date((S.clock += 1000)).toISOString();
function write(t, row, insertOk) {
  const T = tbl(t); const k = pkOf(t, row); const old = T.get(k);
  const n = Object.fromEntries(Object.entries(row).map(([c, v]) => [c, norm(c, v)]));
  if (!old) { if (!insertOk) return; T.set(k, { deleted: false, client_updated_at: '1970-01-01T00:00:00.000Z', ...n, updated_at: now() }); S.writes++; return; }
  if (n.client_updated_at && new Date(n.client_updated_at) < new Date(old.client_updated_at)) return; // keep newer
  T.set(k, { ...old, ...n, updated_at: now() }); S.writes++;
}
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
  select() { return this; }
  eq(c, v) { this.f.push((r) => norm(c, r[c]) === norm(c, v)); return this; }
  match(m) { for (const [c, v] of Object.entries(m)) this.eq(c, v); return this; }
  gte(c, v) { this.f.push((r) => new Date(r[c]) >= new Date(v)); return this; }
  order() { return this; }
  range(a, b) { this.rg = [a, b]; return this; }
  maybeSingle() { this.single = true; return this; }
  update(o) { this.op = 'update'; this.body = o; return this; }
  upsert(rows) { this.op = 'upsert'; this.body = rows; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
  run() {
    if (S.offline) return { data: null, error: { message: 'TypeError: Network request failed' } };
    const T = tbl(this.t);
    if (this.op === 'upsert') { for (const r of this.body) write(this.t, r, true); return { data: null, error: null }; }
    const rows = [...T.values()].filter((r) => this.f.every((f) => f(r)));
    if (this.op === 'update') { for (const r of rows) write(this.t, { ...r, ...this.body }, false); return { data: null, error: null }; }
    let data = rows.sort((a, b) => a.updated_at.localeCompare(b.updated_at)).map(out);
    if (this.rg) data = data.slice(this.rg[0], this.rg[1] + 1);
    if (this.single) data = data[0] ?? null;
    return { data, error: null };
  }
}
export const supabase = { from: (t) => new Q(t) };
export const __server = S;
export function __seedProfile(uid, fullName) {
  tbl('profiles').set(uid, { id: uid, full_name: fullName, settings: {}, client_updated_at: '1970-01-01T00:00:00.000Z', updated_at: now() });
}
