const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function fmtNum(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtKm(n: number) {
  return `${fmtNum(n)} km`;
}

export function fmtDate(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function fmtMoney(n: number) {
  return `₱${fmtNum(n)}`;
}

/** Parse a user-typed number like "12,345" → 12345. Returns null for blank/invalid. */
export function parseNum(s: string): number | null {
  const cleaned = s.replace(/[,\s₱]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
