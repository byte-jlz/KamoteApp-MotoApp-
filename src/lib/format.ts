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

/** "just now", "5 min ago", "3 h ago", or the date. */
export function fmtAgo(iso: string, now = Date.now()) {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  return fmtDate(iso);
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
