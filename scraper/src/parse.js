// Turns a PH news headline like
//   "Oil price hike: Gasoline up P1.20, diesel P0.85; kerosene rollback of 30 centavos"
// into { direction, items: [{ fuel, direction, min, max }] }.

const FUELS = [
  // Bare "gas" means gasoline in PH headlines ("P0.24/L decrease for gas"); LPG clauses are skipped separately.
  ['gasoline', /\b(gasoline|petrol|gas)\b/i],
  ['diesel', /\bdiesel\b/i],
  ['kerosene', /\b(kerosene|gaas)\b/i],
];

const UP = /\b(hikes?|hiked|increases?|increased|up|higher|rise|rises|rising|jumps?|surge|surges|spike|taas|dagdag|umento)\b/i;
const DOWN =
  /\b(rollbacks?|roll\s?back|rolled back|decreases?|decreased|cuts?|down|lower|drops?|dropped|reductions?|reduce[sd]?|slash(?:ed|es)?|bawas|tapyas|ibababa)\b/i;
const NONE = /\b(no (?:price )?(?:change|movement|adjustment)|unchanged|steady)\b/i;

const PESO = String.raw`(?:₱|PHP|Php|P)\s?`;
// (?![\d.]) stops "P162" from being read as "P16" — whole numbers only.
const NUM = String.raw`(\d{1,2}(?:\.\d{1,2})?)(?![\d.])`;
// "P1.20", "₱1 to P1.30", "P0.90-P1.10", "P1 – 1.30"
const AMOUNT = new RegExp(`${PESO}${NUM}(?:\\s?(?:to|-|–|—)\\s?(?:${PESO})?${NUM})?`, 'g');
// "50 centavos", "40 to 60 centavos"
const CENTAVOS = new RegExp(String.raw`(\d{1,2})(?:\s?(?:to|-|–|—)\s?(\d{1,2}))?\s?(?:centavos?|cents?|sentimo)`, 'gi');

// LPG / cooking gas is priced per kilo and changes monthly — not a pump price.
const LPG = /\b(lpg|cooking gas|auto-?lpg)\b|\/\s?kg\b|per kilo/i;
// "surging to P62/liter", "now at P58" — a price level, not an adjustment.
const LEVEL_BEFORE = /\b(?:to|at|reach(?:es|ing)?|hits?|hitting|around|about|nasa)\s*$/i;
// "P3/kg", "P2 per kilo" — amounts that aren't per liter.
const PER_KILO = /^\s?(?:\/\s?kg|per\s?(?:kg|kilo))/i;

function fuelsIn(text) {
  return FUELS.filter(([, re]) => re.test(text)).map(([f]) => f);
}

function directionIn(text) {
  const up = UP.test(text);
  const down = DOWN.test(text);
  if (up && !down) return 'up';
  if (down && !up) return 'down';
  if (!up && !down && NONE.test(text)) return 'none';
  return null; // unknown or mixed
}

function amountIn(text) {
  for (const m of text.matchAll(AMOUNT)) {
    if (PER_KILO.test(text.slice(m.index + m[0].length))) continue;
    if (!m[2] && LEVEL_BEFORE.test(text.slice(0, m.index))) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a > 0 && a < 20 && b > 0 && b < 20) return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  for (const m of text.matchAll(CENTAVOS)) {
    const a = Number(m[1]) / 100;
    const b = m[2] ? Number(m[2]) / 100 : a;
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  return null;
}

/** True if the headline is about local pump prices (not world crude, LPG-only, etc.). */
export function isRelevant(title) {
  const t = title.toLowerCase();
  if (!/(oil|fuel|pump|gasoline|diesel|kerosene|petrol)/.test(t)) return false;
  if (/(per barrel|\$\d|brent|wti)/.test(t) && !/(₱|php|\bp\d)/i.test(title)) return false;
  return Boolean(directionIn(title)) || fuelsIn(title).length > 0;
}

export function parseHeadline(title) {
  const overall = directionIn(title);
  const clauses = title.split(/[,;:|]|\band\b|\bwhile\b|\bbut\b/i);
  const items = [];
  let pending = []; // fuels named in a clause without an amount, e.g. "Diesel, kerosene up P1"

  for (const clause of clauses) {
    if (LPG.test(clause)) {
      pending = []; // don't let "Kerosene tax break; LPG down P3/kg" pair kerosene with an LPG figure
      continue;
    }
    const fuels = fuelsIn(clause);
    const amount = amountIn(clause);
    if (fuels.length && !amount) {
      pending.push(...fuels);
      continue;
    }
    if (!amount) continue;
    const targets = [...new Set([...pending, ...fuels])];
    pending = [];
    const direction = directionIn(clause) ?? overall;
    if (!targets.length || !direction) continue;
    for (const fuel of targets) {
      if (!items.some((i) => i.fuel === fuel)) items.push({ fuel, direction, ...amount });
    }
  }
  return { direction: overall ?? (items.length ? items[0].direction : null), items };
}
