// Simulated phones syncing through a fake server. Run: node --import tsx --import ./register.mjs test.mts
const LIB = new URL('./lib/', import.meta.url).href; // copied from src/lib by copy-lib.mjs
const FAKES = new URL('./fakes/', import.meta.url).href;
const { __server: server, __seedProfile } = await import(FAKES + 'supabase.mjs');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UID = 'u1';

let failures = 0;
function ok(name: string, cond: unknown, extra = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

async function makePhone(name: string) {
  const sync = await import(`${LIB}sync.ts?phone=${name}`);
  const local = await import(`${LIB}localData.ts?phone=${name}`);
  const sd = await import(`${LIB}syncData.ts?phone=${name}`);
  const AS = (await import(`${FAKES}async-storage.mjs?phone=${name}`)).default;
  const p = {
    name, sync, local, sd, AS,
    key: local.GUEST_KEY as string,
    data: local.EMPTY as any,
    detach: null as null | (() => void),
    quiet() { sync.requestSync(1e9); }, // park background timers; tests call syncNow explicitly
    async save() { await AS.setItem(p.key, JSON.stringify(p.data)); await sync.trackSaved(p.key, p.data); p.quiet(); },
    async load(key: string) { p.key = key; p.data = await local.readData(key); },
    async edit(fn: (d: any) => any) { p.data = fn(structuredClone(p.data)); await p.save(); await sleep(5); },
    async login(uid: string) {
      await p.load(local.dataKeyFor(uid));
      p.detach = sync.attachSync({
        userId: uid, storageKey: p.key,
        getData: () => p.data,
        apply: (fn: any) => { const r = fn(p.data); p.data = r.data; (globalThis as any).__deleted.push(...r.removedMedia); },
      });
      p.quiet();
    },
    async syncNow() { await sync.syncNow(); await p.save(); },
    logout() { p.detach?.(); p.detach = null; },
    hashes() { return new Map([...sd.toRows(p.data)].map(([k, r]: any) => [k, sd.hashPayload(r.payload)])); },
  };
  return p;
}

function sameRecords(a: any, b: any) {
  const ha = a.hashes(), hb = b.hashes();
  const diff = [...new Set([...ha.keys(), ...hb.keys()])].filter((k) => ha.get(k) !== hb.get(k));
  return { same: diff.length === 0, diff: diff.slice(0, 5).join(', ') };
}

const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();
function bike(id: string, name: string, readings: number) {
  return {
    id, name, make: 'Honda', model: 'Click 125i', year: '2023', plate: undefined, type: 'scooter', odometer: 1000 + readings * 10,
    createdAt: day(1),
    readings: Array.from({ length: readings }, (_, i) => ({ date: day(1 + i), km: 1000 + i * 10 })),
    items: [
      { id: `${id}-oil`, key: 'engine_oil', name: 'Engine oil', description: 'Change oil', intervalKm: 1500, intervalMonths: 3, enabled: true, lastKm: 1000, lastDate: day(2) },
      { id: `${id}-belt`, key: 'drive_belt', name: 'Drive belt', intervalKm: 20000, intervalMonths: null, enabled: false, dismissed: true, lastKm: 1000, lastDate: day(2) },
    ],
  };
}

// ── 1. Guest phone A has data from before accounts existed ──
const A = await makePhone('A');
await A.load(A.local.GUEST_KEY);
await A.edit((d) => ({
  ...d,
  bikes: [bike('b1', 'Click', 5), bike('b2', 'Mio', 3)],
  logs: [{ id: 'l1', bikeId: 'b1', date: day(3), km: 1020, itemIds: ['b1-oil'], itemNames: ['Engine oil'], cost: 350, shop: 'Shop A' }],
  clubs: [{ id: 'c1', name: 'Click Club PH', role: 'Member', since: '2024', logoFileName: 'logo1.jpg' }],
  photos: [{ id: 'p1', bikeId: 'b1', album: 'ride', fileName: 'ph1.jpg', date: day(4) }],
  profile: { fullName: 'Juan Guest', photoFileName: 'me.jpg' },
  settings: { ...d.settings, theme: 'dark' },
}));
const gMeta = JSON.parse((await A.AS.getItem(A.local.GUEST_KEY + ':sync')) ?? '{}');
ok('guest records get stamps, using their own dates', gMeta.tracked && gMeta.stamps['service_logs|l1']?.t === day(3));
ok('guest keeps no tombstones', Object.values(gMeta.stamps).every((s: any) => s.h !== 'deleted'));

// Account was created at sign-up with a name; nothing else on the server yet.
__seedProfile(UID, 'Juan Dela Cruz');

// ── 2. Login on A + "Upload" ──
await A.sync.moveGuestIntoAccount(UID);
ok('guest copy removed after upload', (await A.AS.getItem(A.local.GUEST_KEY)) === null);
await A.login(UID);
ok('account copy has guest bikes and photos', A.data.bikes.length === 2 && A.data.photos.length === 1 && A.data.profile.photoFileName === 'me.jpg');
await A.syncNow();
const t = (name: string) => [...(server.tables.get(name)?.values() ?? [])];
ok('server got bikes/items/readings/logs/clubs', t('bikes').length === 2 && t('maint_items').length === 4 && t('odometer_readings').length === 8 && t('service_logs').length === 1 && t('clubs').length === 1);
ok('no local-only fields uploaded', !JSON.stringify([...server.tables.values()].map((m: any) => [...m.values()])).match(/ph1\.jpg|logo1\.jpg|me\.jpg/));
ok('A pending is 0 after sync', A.sync.getSyncState().pending === 0, JSON.stringify(A.sync.getSyncState()));
const prof = t('profiles')[0];
ok('sign-up name kept (tie → account wins), guest settings uploaded', prof.full_name === 'Juan Dela Cruz' && prof.settings.theme === 'dark', JSON.stringify(prof));
ok('A shows the account name', A.data.profile.fullName === 'Juan Dela Cruz');

// ── 3. Idempotent: syncing again writes nothing ──
const w0 = server.writes;
await A.syncNow();
await A.syncNow();
ok('repeat syncs write nothing', server.writes === w0, `${server.writes - w0} writes`);

// ── 4. Fresh phone B logs in ──
const B = await makePhone('B');
await B.login(UID);
await B.syncNow();
let s = sameRecords(A, B);
ok('B gets everything A has', s.same, s.diff);
ok('B keeps A settings (does not reset to defaults)', B.data.settings.theme === 'dark' && t('profiles')[0].settings.theme === 'dark');
ok('B has no photos (phone-only)', B.data.photos.length === 0 && !B.data.clubs[0].logoFileName);
const w1 = server.writes;
await B.syncNow();
ok('B repeat sync writes nothing', server.writes === w1, `${server.writes - w1} writes`);

// ── 5. Edits on B reach A ──
await B.edit((d) => {
  d.bikes[0].name = 'Click (B)';
  d.logs.unshift({ id: 'l2', bikeId: 'b2', date: day(10), km: 1030, itemIds: [], itemNames: [], cost: null });
  d.clubs = [];
  return d;
});
await B.syncNow();
await A.syncNow();
s = sameRecords(A, B);
ok('A matches B after edits (rename, new log, deleted club)', s.same, s.diff);
ok('A deleted the club logo file', (globalThis as any).__deleted.includes('logo1.jpg'));

// ── 6. Conflict: A edits offline first, B edits later → B wins everywhere ──
server.offline = true;
await A.edit((d) => { d.bikes[1].name = 'Mio (A, older)'; return d; });
await A.syncNow();
ok('offline sync reports offline, keeps change pending', A.sync.getSyncState().status === 'offline' && A.sync.getSyncState().pending === 1, JSON.stringify(A.sync.getSyncState()));
server.offline = false;
await sleep(10);
await B.edit((d) => { d.bikes[1].name = 'Mio (B, newer)'; return d; });
await B.syncNow();
await A.syncNow();
await B.syncNow();
ok('newer edit (B) wins on A', A.data.bikes[1].name === 'Mio (B, newer)', A.data.bikes[1].name);
ok('server has newer edit', t('bikes').find((r: any) => r.id === 'b2').name === 'Mio (B, newer)');

// ── 7. Conflict: B edits first (synced), A edits later offline → A wins everywhere ──
await B.edit((d) => { d.bikes[1].odometer = 5000; return d; });
await B.syncNow();
await sleep(10);
server.offline = true;
await A.edit((d) => { d.bikes[1].odometer = 6000; return d; });
await A.syncNow();
server.offline = false;
await A.syncNow();
await B.syncNow();
ok('newer offline edit (A) wins on B', B.data.bikes[1].odometer === 6000 && A.data.bikes[1].odometer === 6000, `${A.data.bikes[1].odometer}/${B.data.bikes[1].odometer}`);

// ── 8. Bike deleted on B disappears on A, with its photos ──
await A.edit((d) => { d.photos.push({ id: 'p2', bikeId: 'b2', album: 'ride', fileName: 'ph2.jpg', date: day(5) }); return d; });
await B.edit((d) => { d.bikes = d.bikes.filter((b: any) => b.id !== 'b2'); d.logs = d.logs.filter((l: any) => l.bikeId !== 'b2'); return d; });
await B.syncNow();
await A.syncNow();
ok('deleted bike gone on A (logs too)', !A.data.bikes.some((b: any) => b.id === 'b2') && !A.data.logs.some((l: any) => l.bikeId === 'b2'));
ok('its photos removed on A', !A.data.photos.some((p: any) => p.id === 'p2') && (globalThis as any).__deleted.includes('ph2.jpg'));
s = sameRecords(A, B);
ok('A and B match', s.same, s.diff);

// ── 9. Readings trimmed to 60 sync as deletions ──
await A.edit((d) => {
  const b = d.bikes[0];
  for (let i = 0; i < 70; i++) b.readings.push({ date: day(20 + i), km: 2000 + i });
  b.readings = b.readings.slice(-60);
  return d;
});
await A.syncNow();
await B.syncNow();
ok('B has the same 60 readings', B.data.bikes[0].readings.length === 60 && sameRecords(A, B).same, String(B.data.bikes[0].readings.length));
await A.syncNow();
const metaA = JSON.parse((await A.AS.getItem(A.key + ':sync'))!);
ok('synced tombstones are cleaned up', !Object.values(metaA.stamps).some((x: any) => x.h === 'deleted'), String(Object.values(metaA.stamps).filter((x: any) => x.h === 'deleted').length));

// ── 10. Name edited in Edit Profile syncs ──
await B.edit((d) => { d.profile = { ...d.profile, fullName: 'Juan D. Cruz' }; return d; });
await B.syncNow();
await A.syncNow();
ok('name change reaches A and the server', A.data.profile.fullName === 'Juan D. Cruz' && t('profiles')[0].full_name === 'Juan D. Cruz');

// ── 11. Phone C: guest data merges into an account that already has data ──
const C = await makePhone('C');
await C.load(C.local.GUEST_KEY);
const accountB1 = structuredClone(A.data.bikes[0]);
await C.edit((d) => ({
  ...d,
  bikes: [
    { ...structuredClone(accountB1), name: 'Old guest copy' }, // same id, edited "now" on C → newer than account
    bike('b9', 'Raider', 2),
  ],
  photos: [{ id: 'p9', bikeId: 'b9', album: 'bike', fileName: 'ph9.jpg', date: day(6) }],
}));
await sleep(10);
await A.edit((d) => { d.bikes[0].plate = 'ABC 123'; return d; }); // account edit after C's
await A.syncNow();
// C's guest stamps for b1 are older than A's plate edit → account version wins for b1.
await C.sync.moveGuestIntoAccount(UID);
await C.login(UID);
await C.syncNow();
await A.syncNow();
ok('C: newer account edit kept for shared bike', C.data.bikes.find((b: any) => b.id === 'b1').plate === 'ABC 123' && C.data.bikes.find((b: any) => b.id === 'b1').name !== 'Old guest copy');
ok('C: guest-only bike merged and uploaded, reaches A', A.data.bikes.some((b: any) => b.id === 'b9') && C.data.photos.some((p: any) => p.id === 'p9'));
s = sameRecords(A, C);
ok('A and C match', s.same, s.diff);

// ── 12. Logout "keep a copy" on C, then "remove" on A ──
C.logout();
await C.sync.moveAccountToGuest(UID);
const cGuest = await C.local.readData(C.local.GUEST_KEY);
ok('keep: records + photos now guest data on C', cGuest.bikes.length === A.data.bikes.length && cGuest.photos.some((p: any) => p.id === 'p9'));
ok('keep: account copy removed on C', (await C.AS.getItem(C.local.dataKeyFor(UID))) === null);

(globalThis as any).__deleted.length = 0;
A.logout();
await A.sync.clearAccountData(UID);
ok('remove: account copy gone on A', (await A.AS.getItem(A.local.dataKeyFor(UID))) === null);
ok('remove: A photos deleted', (globalThis as any).__deleted.includes('ph1.jpg') && (globalThis as any).__deleted.includes('me.jpg'));
ok('remove: server data untouched', t('bikes').filter((r: any) => !r.deleted).length === A.data.bikes.length);

// ── 13. Log back in on A: everything comes back from the server ──
await A.login(UID);
await A.syncNow();
s = sameRecords(A, B);
await B.syncNow();
s = sameRecords(A, B);
ok('A restored from server after remove + login', s.same && A.data.bikes.length === 2, s.diff);

// ── 14. Round trip: data → server → data is lossless for synced fields ──
const before = B.hashes();
const D = await makePhone('D');
await D.login(UID);
await D.syncNow();
const after = D.hashes();
ok('fresh phone reproduces identical records', [...before].every(([k, h]) => after.get(k) === h) && before.size === after.size);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
