import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export type FuelType = 'gasoline' | 'diesel' | 'kerosene';
export type Direction = 'up' | 'down' | 'none';

export interface FuelAdjustment {
  id: number;
  effective_date: string; // YYYY-MM-DD
  fuel_type: FuelType;
  direction: Direction;
  amount_min: number; // ₱ per liter
  amount_max: number;
  headline: string;
  source_url: string | null;
  source_name: string | null;
  detected_at: string;
}

export interface FuelHeadline {
  id: number;
  title: string;
  url: string;
  source_name: string | null;
  published_at: string | null;
  direction: Direction | null;
}

export interface FuelData {
  adjustments: FuelAdjustment[];
  headlines: FuelHeadline[];
  fetchedAt: string;
}

export const FUEL_META: Record<FuelType, { label: string; icon: string }> = {
  gasoline: { label: 'Gasoline', icon: '⛽' },
  diesel: { label: 'Diesel', icon: '🛢️' },
  kerosene: { label: 'Kerosene', icon: '🔥' },
};

const FUEL_ORDER: FuelType[] = ['gasoline', 'diesel', 'kerosene'];
const CACHE_KEY = 'motomonitor:fuel:v1';

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
};

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Last fuel data we saw, so the card shows something offline. */
export async function cachedFuel(): Promise<FuelData | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as FuelData) : null;
  } catch {
    return null;
  }
}

export async function fetchFuel(): Promise<FuelData> {
  const [adjustments, headlines] = await Promise.all([
    rest<FuelAdjustment[]>('fuel_adjustments?select=*&order=effective_date.desc,fuel_type.asc&limit=60'),
    rest<FuelHeadline[]>('fuel_headlines?select=*&order=published_at.desc.nullslast&limit=20'),
  ]);
  const data: FuelData = { adjustments, headlines, fetchedAt: new Date().toISOString() };
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)).catch(() => {});
  return data;
}

/** Adjustments grouped by effective date (newest first), each sorted gasoline → diesel → kerosene. */
export function groupByWeek(adjustments: FuelAdjustment[]) {
  const map = new Map<string, FuelAdjustment[]>();
  for (const a of adjustments) {
    const list = map.get(a.effective_date) ?? [];
    list.push(a);
    map.set(a.effective_date, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({
      date,
      items: list.sort((a, b) => FUEL_ORDER.indexOf(a.fuel_type) - FUEL_ORDER.indexOf(b.fuel_type)),
    }));
}

/** "₱1.20" or "₱1.00–1.20" */
export function fmtAmount(a: Pick<FuelAdjustment, 'amount_min' | 'amount_max'>) {
  const lo = Number(a.amount_min).toFixed(2);
  const hi = Number(a.amount_max).toFixed(2);
  return lo === hi ? `₱${hi}` : `₱${lo}–${hi}`;
}

/** Register (or update) this phone's FCM token so the scraper can send fuel alerts. */
export async function registerDevice(token: string, platform: string, fuelAlerts: boolean) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/register_device`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_token: token, p_platform: platform, p_fuel_alerts: fuelAlerts }),
  });
  if (!res.ok) throw new Error(`register_device ${res.status}: ${await res.text()}`);
}

// ── Shared state: one fetch feeds the card, the side panel and the screen ──

export interface FuelState {
  data: FuelData | null;
  error: boolean;
  loading: boolean;
}

let state: FuelState = { data: null, error: false, loading: false };
let inflight: Promise<void> | null = null;
let cacheLoaded = false;
const listeners = new Set<() => void>();
const STALE_MS = 5 * 60 * 1000;

function set(patch: Partial<FuelState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribeFuel(listener: () => void) {
  listeners.add(listener);
  if (!cacheLoaded) {
    cacheLoaded = true;
    cachedFuel().then((c) => c && !state.data && set({ data: c }));
  }
  return () => {
    listeners.delete(listener);
  };
}

export function getFuelState() {
  return state;
}

/** Fetch fresh data unless we fetched in the last few minutes (`force` skips that check). */
export function refreshFuel(force = false) {
  if (inflight) return inflight;
  const age = state.data && !state.error ? Date.now() - new Date(state.data.fetchedAt).getTime() : Infinity;
  if (!force && age < STALE_MS) return Promise.resolve();
  set({ loading: true });
  inflight = fetchFuel()
    .then((data) => set({ data, error: false }))
    .catch((e) => {
      console.warn('Fuel fetch failed', e);
      set({ error: true });
    })
    .finally(() => {
      inflight = null;
      set({ loading: false });
    });
  return inflight;
}
