import { Bike, MaintItem } from './types';
import { fmtNum } from './format';

export type Status = 'overdue' | 'soon' | 'ok' | 'off';

export interface ItemStatus {
  status: Status;
  kmLeft: number | null;
  daysLeft: number | null;
  /** 0 = just serviced, 1 = due. Can exceed 1 when overdue. */
  progress: number;
  /** Best guess of when the item comes due, using the rider's average km/day for distance intervals. */
  estDate: Date | null;
}

const DAY = 86_400_000;
const SOON_FRACTION = 0.85;

export function addMonths(iso: string, months: number) {
  const d = new Date(iso);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0); // clamp e.g. Jan 31 + 1 month → Feb 28
  return d;
}

/** Average km per day from odometer readings in the last ~90 days. Null if not enough data. */
export function kmPerDay(bike: Bike): number | null {
  const cutoff = Date.now() - 90 * DAY;
  const recent = bike.readings.filter((r) => new Date(r.date).getTime() >= cutoff);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const days = (new Date(last.date).getTime() - new Date(first.date).getTime()) / DAY;
  const km = last.km - first.km;
  if (days < 5 || km <= 0) return null;
  return km / days;
}

export function itemStatus(bike: Bike, item: MaintItem, now = new Date()): ItemStatus {
  if (!item.enabled) return { status: 'off', kmLeft: null, daysLeft: null, progress: 0, estDate: null };

  let progress = 0;
  let kmLeft: number | null = null;
  let daysLeft: number | null = null;
  let dueDate: Date | null = null;

  if (item.intervalKm) {
    const used = bike.odometer - item.lastKm;
    kmLeft = item.intervalKm - used;
    progress = Math.max(progress, used / item.intervalKm);
  }
  if (item.intervalMonths) {
    dueDate = addMonths(item.lastDate, item.intervalMonths);
    const total = dueDate.getTime() - new Date(item.lastDate).getTime();
    const elapsed = now.getTime() - new Date(item.lastDate).getTime();
    daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / DAY);
    progress = Math.max(progress, elapsed / total);
  }

  let estDate = dueDate;
  if (kmLeft !== null) {
    const rate = kmPerDay(bike);
    if (kmLeft <= 0) estDate = now;
    else if (rate) {
      const byKm = new Date(now.getTime() + (kmLeft / rate) * DAY);
      if (!estDate || byKm < estDate) estDate = byKm;
    }
  }

  let status: Status = 'ok';
  if (progress >= 1 || (kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft <= 0)) status = 'overdue';
  else if (progress >= SOON_FRACTION || (daysLeft !== null && daysLeft <= 7)) status = 'soon';

  return { status, kmLeft, daysLeft, progress: Math.max(0, progress), estDate };
}

export function dueText(s: ItemStatus) {
  const parts: string[] = [];
  if (s.kmLeft !== null) {
    parts.push(s.kmLeft <= 0 ? `${fmtNum(-s.kmLeft)} km overdue` : `${fmtNum(s.kmLeft)} km left`);
  }
  if (s.daysLeft !== null) {
    if (s.daysLeft < 0) parts.push(`${-s.daysLeft} day${s.daysLeft === -1 ? '' : 's'} overdue`);
    else if (s.daysLeft === 0) parts.push('due today');
    else parts.push(`${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left`);
  }
  return parts.join(' · ');
}

export function intervalText(item: MaintItem) {
  const parts: string[] = [];
  if (item.intervalKm) parts.push(`${fmtNum(item.intervalKm)} km`);
  if (item.intervalMonths) parts.push(`${item.intervalMonths} mo${item.intervalMonths === 1 ? '' : 's'}`);
  return parts.length ? `Every ${parts.join(' or ')}` : 'No interval';
}

const RANK: Record<Status, number> = { overdue: 0, soon: 1, ok: 2, off: 3 };

export function sortedItems(bike: Bike) {
  return bike.items
    .map((item) => ({ item, s: itemStatus(bike, item) }))
    .sort((a, b) => RANK[a.s.status] - RANK[b.s.status] || b.s.progress - a.s.progress);
}

export function bikeSummary(bike: Bike) {
  let overdue = 0;
  let soon = 0;
  for (const item of bike.items) {
    const s = itemStatus(bike, item).status;
    if (s === 'overdue') overdue++;
    else if (s === 'soon') soon++;
  }
  return { overdue, soon };
}
