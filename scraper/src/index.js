import { createClient } from '@supabase/supabase-js';
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { effectiveDateFor, fmtShort, phDate } from './dates.js';
import { isRelevant, parseHeadline } from './parse.js';
import { fetchHeadlines } from './sources.js';

// --dry-run: fetch and parse only; print what would be saved/sent. Needs no secrets.
const DRY_RUN = process.argv.includes('--dry-run');

const FUEL_LABEL = { gasoline: 'Gasoline', diesel: 'Diesel', kerosene: 'Kerosene' };
const ORDER = ['gasoline', 'diesel', 'kerosene'];
const ARROW = { up: '▲', down: '▼', none: '•' };

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} (set it as a GitHub Actions secret)`);
  return v;
}

const fmtAmount = (a) => (a.amount_min === a.amount_max ? `₱${a.amount_max.toFixed(2)}` : `₱${a.amount_min.toFixed(2)}–${a.amount_max.toFixed(2)}`);

/** Pick one figure per (Tuesday, fuel): the most recently published headline wins (estimates get refined). */
function detectAdjustments(headlines) {
  const best = new Map();
  for (const h of headlines) {
    if (!h.published) continue;
    const { items } = parseHeadline(h.title);
    const effective_date = effectiveDateFor(h.title, h.published);
    for (const it of items) {
      const key = `${effective_date}|${it.fuel}`;
      const prev = best.get(key);
      if (prev && prev.published >= h.published) continue;
      best.set(key, {
        published: h.published,
        row: {
          effective_date,
          fuel_type: it.fuel,
          direction: it.direction,
          amount_min: it.min,
          amount_max: it.max,
          headline: h.title,
          source_url: h.url,
          source_name: h.source,
        },
      });
    }
  }
  return [...best.values()].map((b) => b.row);
}

function sameFigure(a, b) {
  return a.direction === b.direction && Number(a.amount_min) === Number(b.amount_min) && Number(a.amount_max) === Number(b.amount_max);
}

async function sendPush(db, rows) {
  // One notification for the nearest upcoming Tuesday that changed.
  const date = rows.map((r) => r.effective_date).sort()[0];
  const forDate = rows.filter((r) => r.effective_date === date).sort((a, b) => ORDER.indexOf(a.fuel_type) - ORDER.indexOf(b.fuel_type));
  const ups = forDate.filter((r) => r.direction === 'up').length;
  const downs = forDate.filter((r) => r.direction === 'down').length;
  const kind = ups && downs ? 'Mixed price adjustment' : ups ? 'Price hike' : downs ? 'Rollback' : 'Price update';
  const title = `⛽ ${kind} · ${fmtShort(date)}`;
  const body = forDate.map((r) => `${FUEL_LABEL[r.fuel_type]} ${ARROW[r.direction]} ${fmtAmount(r)}`).join(' · ') + ' per liter';

  if (DRY_RUN) {
    console.log(`[dry-run] push: ${title}\n          ${body}`);
    return;
  }

  const { data: devices, error } = await db.from('devices').select('token').eq('fuel_alerts', true);
  if (error) throw error;
  const tokens = devices.map((d) => d.token);
  console.log(`Sending "${title}" to ${tokens.length} device(s)`);
  if (!tokens.length) return;

  initializeApp({ credential: cert(JSON.parse(env('FIREBASE_SERVICE_ACCOUNT'))) });
  const messaging = getMessaging();
  const dead = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const res = await messaging.sendEachForMulticast({
      tokens: batch,
      notification: { title, body },
      data: { screen: 'fuel', effective_date: date },
      android: { priority: 'high', notification: { channelId: 'fuel-alerts', color: '#EA580C' } },
    });
    res.responses.forEach((r, j) => {
      const code = r.error?.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') dead.push(batch[j]);
    });
    console.log(`  batch ${i / 500 + 1}: ${res.successCount} sent, ${res.failureCount} failed`);
  }
  if (dead.length) {
    await db.from('devices').delete().in('token', dead);
    console.log(`  removed ${dead.length} uninstalled device(s)`);
  }
}

async function main() {
  const all = await fetchHeadlines();
  const relevant = all.filter((h) => isRelevant(h.title));
  const rows = detectAdjustments(relevant);
  console.log(`${all.length} headlines, ${relevant.length} relevant, ${rows.length} fuel figure(s) detected`);
  for (const r of rows) console.log(`  ${r.effective_date} ${r.fuel_type.padEnd(8)} ${ARROW[r.direction]} ${fmtAmount(r)}  ← ${r.headline}`);

  const today = phDate(new Date());

  if (DRY_RUN) {
    const upcoming = rows.filter((r) => r.effective_date >= today);
    if (upcoming.length) await sendPush(null, upcoming);
    return;
  }

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  // Headlines (title + link) for the app's news list; existing URLs are left alone.
  if (relevant.length) {
    const { error } = await db.from('fuel_headlines').upsert(
      relevant.map((h) => ({
        title: h.title,
        url: h.url,
        source_name: h.source,
        published_at: h.published?.toISOString() ?? null,
        direction: parseHeadline(h.title).direction,
      })),
      { onConflict: 'url', ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  if (!rows.length) return;

  const dates = [...new Set(rows.map((r) => r.effective_date))];
  const { data: existing, error } = await db.from('fuel_adjustments').select('*').in('effective_date', dates);
  if (error) throw error;

  const changed = [];
  for (const r of rows) {
    const prev = existing.find((e) => e.effective_date === r.effective_date && e.fuel_type === r.fuel_type);
    if (prev && sameFigure(prev, r)) continue;
    const { error: upErr } = await db
      .from('fuel_adjustments')
      .upsert({ ...r, updated_at: new Date().toISOString() }, { onConflict: 'effective_date,fuel_type' });
    if (upErr) throw upErr;
    console.log(`${prev ? 'Updated' : 'Saved'} ${r.effective_date} ${r.fuel_type}`);
    // Only alert about changes that haven't taken effect yet (or take effect today) — never stale news.
    if (r.effective_date >= today && (!prev || prev.direction !== r.direction)) changed.push(r);
  }

  if (changed.length) await sendPush(db, changed);
  else console.log('Nothing new to notify.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
