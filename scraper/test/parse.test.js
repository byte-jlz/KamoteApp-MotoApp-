import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveDateFor, effectiveTuesday } from '../src/dates.js';
import { isRelevant, parseHeadline } from '../src/parse.js';

const pick = (title) => Object.fromEntries(parseHeadline(title).items.map((i) => [i.fuel, [i.direction, i.min, i.max]]));

test('same direction for all fuels', () => {
  assert.deepEqual(pick('Oil price hike: Gasoline up P1.20, diesel P0.85, kerosene P0.60 per liter'), {
    gasoline: ['up', 1.2, 1.2],
    diesel: ['up', 0.85, 0.85],
    kerosene: ['up', 0.6, 0.6],
  });
});

test('mixed directions per clause', () => {
  assert.deepEqual(pick('Diesel, kerosene up P1 per liter; gasoline rollback of P0.50 on Tuesday'), {
    diesel: ['up', 1, 1],
    kerosene: ['up', 1, 1],
    gasoline: ['down', 0.5, 0.5],
  });
});

test('ranges and centavos', () => {
  assert.deepEqual(pick('Big-time rollback looms: diesel down P1.40 to P1.60, gasoline 40-60 centavos lower'), {
    diesel: ['down', 1.4, 1.6],
    gasoline: ['down', 0.4, 0.6],
  });
});

test('peso sign and PHP prefix', () => {
  assert.deepEqual(pick('Fuel prices to increase anew: ₱2.10 for gasoline'), { gasoline: ['up', 2.1, 2.1] });
  assert.deepEqual(pick('Diesel price cut of PHP 0.75 per liter next week'), { diesel: ['down', 0.75, 0.75] });
});

test('ignores headlines without amounts or fuels', () => {
  assert.deepEqual(pick('Oil price hike expected next week, DOE says'), {});
  assert.deepEqual(pick('LPG prices up P2 per kilo this month'), {});
});

test('real headline: "gas" means gasoline', () => {
  assert.deepEqual(pick('PH fuel price update: P0.24/L decrease for gas, P7.57/L for diesel effective September 29'), {
    gasoline: ['down', 0.24, 0.24],
    diesel: ['down', 7.57, 7.57],
  });
});

test('real headline: LPG per-kilo figures are not pump prices', () => {
  assert.deepEqual(
    pick('IMF Backs LPG, Kerosene Tax Break but Warns Against Gasoline Relief; LPG Seen Dropping P3/Kg Before Possible P10–P15 Hike'),
    {},
  );
});

test('real headline: mixed with "while"', () => {
  assert.deepEqual(pick('Diesel prices went down by P1.55 per liter, while gasoline went up by P0.29 per liter.'), {
    diesel: ['down', 1.55, 1.55],
    gasoline: ['up', 0.29, 0.29],
  });
});

test('real headline: price levels are not adjustments', () => {
  assert.deepEqual(pick('Diesel seen surging to P162/liter as worst-case oil shock threatens PH inflation spike'), {});
  assert.deepEqual(pick('Gasoline now at P58 per liter in Metro Manila'), {});
  // Under the ₱20 sanity cap, so only the "to/at" rule stops these
  assert.deepEqual(pick('Diesel price hike to reach P15 per liter by December'), {});
  assert.deepEqual(pick('Kerosene up, hitting P9.50 in some areas'), {});
  // ...but "up P1 to P1.30" is still a range
  assert.deepEqual(pick('Diesel up P1 to P1.30 per liter next week'), { diesel: ['up', 1, 1.3] });
});

test('relevance filter', () => {
  assert.equal(isRelevant('Oil firms announce gasoline price hike'), true);
  assert.equal(isRelevant('Brent crude rises to $85 per barrel'), false);
  assert.equal(isRelevant('Typhoon to hit Luzon this weekend'), false);
});

test('effective date: explicit, past tense, upcoming', () => {
  const wed = new Date('2026-09-30T02:00:00Z'); // Wed 10 AM PH
  assert.equal(effectiveDateFor('P0.24/L decrease for gas effective September 29', new Date('2026-09-28T02:00:00Z')), '2026-09-29');
  assert.equal(effectiveDateFor('Diesel prices went down by P1.55 per liter', wed), '2026-09-29');
  assert.equal(effectiveDateFor('Diesel rollback of P1 looms next week', wed), '2026-10-06');
  assert.equal(effectiveDateFor('Gasoline up P1 effective Jan 5', new Date('2026-12-30T02:00:00Z')), '2027-01-05');
});

test('effective Tuesday in PH time', () => {
  assert.equal(effectiveTuesday(new Date('2026-10-05T03:00:00Z')), '2026-10-06'); // Mon 11 AM PH → Tue
  assert.equal(effectiveTuesday(new Date('2026-10-05T17:00:00Z')), '2026-10-06'); // Tue 1 AM PH → same day
  assert.equal(effectiveTuesday(new Date('2026-10-03T02:00:00Z')), '2026-10-06'); // Sat → next Tue
});
