// PH pump price adjustments take effect on Tuesdays (usually 6:00 AM).
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

/** YYYY-MM-DD of `date` in Philippine time. */
export function phDate(date) {
  return new Date(date.getTime() + PH_OFFSET_MS).toISOString().slice(0, 10);
}

/** The Tuesday an adjustment announced at `published` applies to (same day if published on a Tuesday). */
export function effectiveTuesday(published) {
  const d = new Date(`${phDate(published)}T00:00:00Z`);
  const daysUntilTue = (2 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + daysUntilTue);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const EXPLICIT = /\b(?:effective|starting|beginning|on|this|from)\s+(?:(?:mon|tues?|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i;
// Reports written after the fact ("went down", "took effect") describe the Tuesday that just passed.
const PAST = /\b(went|were|was|rolled back|took effect|implemented|hiked|cut)\b/i;

/**
 * Which Tuesday a headline's adjustment applies to:
 * an explicit date in the headline wins; past-tense reports from Tue–Sat mean the Tuesday just gone;
 * otherwise the coming Tuesday.
 */
export function effectiveDateFor(title, published) {
  const m = title.match(EXPLICIT);
  if (m) {
    const pubDay = new Date(`${phDate(published)}T00:00:00Z`);
    let year = pubDay.getUTCFullYear();
    const month = MONTHS.indexOf(m[1].toLowerCase());
    // "effective Jan 2" announced in late December belongs to next year.
    if (month === 0 && pubDay.getUTCMonth() === 11) year += 1;
    return new Date(Date.UTC(year, month, Number(m[2]))).toISOString().slice(0, 10);
  }
  const d = new Date(`${phDate(published)}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 Sun … 6 Sat
  if (PAST.test(title) && dow >= 2 && dow <= 6) {
    d.setUTCDate(d.getUTCDate() - (dow - 2));
    return d.toISOString().slice(0, 10);
  }
  return effectiveTuesday(published);
}

export function fmtShort(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
