import { BikeType, MaintItem } from './types';
import { uid } from './format';

export const BIKE_TYPES: { value: BikeType; label: string; hint: string }[] = [
  { value: 'scooter', label: 'Scooter / Automatic', hint: 'CVT, e.g. Click, NMAX, Aerox, Mio' },
  { value: 'underbone', label: 'Underbone', hint: 'e.g. Wave, Raider, Sniper, Smash' },
  { value: 'manual', label: 'Manual / Standard', hint: 'e.g. TMX, XRM, Rusi, Barako' },
  { value: 'bigbike', label: 'Big Bike (400cc+)', hint: 'Sport, naked, adventure, cruiser' },
];

export function bikeTypeLabel(t: BikeType) {
  return BIKE_TYPES.find((b) => b.value === t)?.label ?? t;
}

interface Template {
  key: string;
  name: string;
  description: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  types: BikeType[]; // bike types where this is recommended
  important?: boolean; // highlighted first in recommendations
  overrides?: Partial<Record<BikeType, { intervalKm?: number | null; intervalMonths?: number | null }>>;
}

const ALL: BikeType[] = ['scooter', 'underbone', 'manual', 'bigbike'];
const CHAIN: BikeType[] = ['underbone', 'manual', 'bigbike'];

// Typical intervals for everyday riding. Always defer to your owner's manual —
// every item can be edited per bike inside the app.
export const TEMPLATES: Template[] = [
  {
    key: 'engine_oil',
    important: true,
    name: 'Engine Oil Change',
    description: 'Replace engine oil. The most important PMS item.',
    intervalKm: 1500,
    intervalMonths: 3,
    types: ALL,
    overrides: { bigbike: { intervalKm: 5000, intervalMonths: 6 } },
  },
  {
    key: 'oil_filter',
    name: 'Oil Filter',
    description: 'Replace the oil filter (or clean the oil strainer).',
    intervalKm: 3000,
    intervalMonths: 6,
    types: ['manual', 'bigbike'],
    overrides: { bigbike: { intervalKm: 10000, intervalMonths: 12 } },
  },
  {
    key: 'gear_oil',
    important: true,
    name: 'Gear Oil',
    description: 'Replace final drive / transmission gear oil.',
    intervalKm: 3000,
    intervalMonths: 6,
    types: ['scooter'],
  },
  {
    key: 'cvt_cleaning',
    name: 'CVT Cleaning',
    description: 'Clean CVT, check rollers, clutch lining and belt wear.',
    intervalKm: 5000,
    intervalMonths: 6,
    types: ['scooter'],
  },
  {
    key: 'drive_belt',
    name: 'Drive Belt Replacement',
    description: 'Replace CVT drive belt.',
    intervalKm: 20000,
    intervalMonths: 24,
    types: ['scooter'],
  },
  {
    key: 'chain',
    important: true,
    name: 'Chain Clean & Lube',
    description: 'Clean, lube and adjust chain slack.',
    intervalKm: 500,
    intervalMonths: 1,
    types: CHAIN,
    overrides: { bigbike: { intervalKm: 800 } },
  },
  {
    key: 'air_filter',
    name: 'Air Filter',
    description: 'Clean or replace the air filter element.',
    intervalKm: 6000,
    intervalMonths: 12,
    types: ALL,
  },
  {
    key: 'spark_plug',
    name: 'Spark Plug',
    description: 'Inspect and replace spark plug.',
    intervalKm: 8000,
    intervalMonths: 12,
    types: ALL,
    overrides: { bigbike: { intervalKm: 16000, intervalMonths: 24 } },
  },
  {
    key: 'brakes',
    important: true,
    name: 'Brake Pads / Shoes Check',
    description: 'Check pad and shoe thickness; adjust or replace.',
    intervalKm: 3000,
    intervalMonths: 6,
    types: ALL,
  },
  {
    key: 'brake_fluid',
    name: 'Brake Fluid',
    description: 'Flush and replace brake fluid (DOT 3/4).',
    intervalKm: null,
    intervalMonths: 24,
    types: ALL,
  },
  {
    key: 'tires',
    important: true,
    name: 'Tire Pressure & Tread',
    description: 'Check tire pressure, tread depth and sidewall cracks.',
    intervalKm: 1000,
    intervalMonths: 1,
    types: ALL,
  },
  {
    key: 'battery',
    name: 'Battery Check',
    description: 'Check terminals, voltage and electrolyte level.',
    intervalKm: null,
    intervalMonths: 6,
    types: ALL,
  },
  {
    key: 'valve_clearance',
    name: 'Valve Clearance',
    description: 'Check and adjust valve clearance (tappets).',
    intervalKm: 12000,
    intervalMonths: 12,
    types: CHAIN,
    overrides: { bigbike: { intervalKm: 24000, intervalMonths: 24 } },
  },
  {
    key: 'coolant',
    name: 'Coolant',
    description: 'Replace radiator coolant (liquid-cooled bikes only).',
    intervalKm: 12000,
    intervalMonths: 24,
    types: ['bigbike'],
  },
  {
    key: 'throttle_body',
    name: 'Throttle Body Cleaning',
    description: 'Clean throttle body / carburetor.',
    intervalKm: 10000,
    intervalMonths: 12,
    types: [],
  },
];

export function defaultItems(type: BikeType, odometer: number, dateISO: string): MaintItem[] {
  return TEMPLATES.map((t) => {
    const o = t.overrides?.[type] ?? {};
    return {
      id: uid(),
      key: t.key,
      name: t.name,
      description: t.description,
      intervalKm: o.intervalKm !== undefined ? o.intervalKm : t.intervalKm,
      intervalMonths: o.intervalMonths !== undefined ? o.intervalMonths : t.intervalMonths,
      enabled: false, // the rider picks what to track; see recommendedItems()
      lastKm: odometer,
      lastDate: dateISO,
    };
  });
}

const ITEM_ICONS: Record<string, string> = {
  engine_oil: '🛢️',
  oil_filter: '🧪',
  gear_oil: '⚙️',
  cvt_cleaning: '🌀',
  drive_belt: '➰',
  chain: '⛓️',
  air_filter: '💨',
  spark_plug: '⚡',
  brakes: '🛑',
  brake_fluid: '💧',
  tires: '⭕',
  battery: '🔋',
  valve_clearance: '🔧',
  coolant: '🌡️',
  throttle_body: '🧼',
};

export function itemIcon(key: string) {
  return ITEM_ICONS[key] ?? '🛠️';
}

/** Untracked items the system suggests for this bike type — important ones first. */
export function recommendedItems(type: BikeType, items: MaintItem[]) {
  return TEMPLATES.filter((t) => t.types.includes(type))
    .sort((a, b) => Number(!!b.important) - Number(!!a.important))
    .map((t) => ({ item: items.find((i) => i.key === t.key && !i.enabled && !i.dismissed), important: !!t.important }))
    .filter((x): x is { item: MaintItem; important: boolean } => !!x.item);
}
