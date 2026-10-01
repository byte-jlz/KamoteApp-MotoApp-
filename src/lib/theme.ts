import { StyleSheet } from 'react-native';

export type ThemeName = 'light' | 'dark';
export type ThemePref = ThemeName | 'system';

const light = {
  bg: '#F3F4F6',
  card: '#FFFFFF',
  inputBg: '#F9FAFB',
  text: '#111827',
  muted: '#6B7280',
  placeholder: '#9CA3AF',
  border: '#E5E7EB',
  header: '#111827',
  primary: '#EA580C',
  primaryBg: '#FFEDD5',
  danger: '#DC2626',
  dangerBg: '#FEE2E2',
  warn: '#B45309',
  warnBg: '#FEF3C7',
  ok: '#15803D',
  okBg: '#DCFCE7',
  offBg: '#F3F4F6',
};

export type Palette = typeof light;

// Soft dark grays rather than pure black, and muted status colors, so it's easy on the eyes at night.
const dark: Palette = {
  bg: '#121418',
  card: '#1B1E24',
  inputBg: '#22262D',
  text: '#E5E7EB',
  muted: '#9CA3AF',
  placeholder: '#6B7280',
  border: '#2C313A',
  header: '#0D0F12',
  primary: '#F97316',
  primaryBg: '#3B2416',
  danger: '#F87171',
  dangerBg: '#3A1E1E',
  warn: '#FBBF24',
  warnBg: '#3A2E14',
  ok: '#4ADE80',
  okBg: '#16301F',
  offBg: '#22262D',
};

const palettes: Record<ThemeName, Palette> = { light, dark };
let current: ThemeName = 'light';

/** Called by the store while rendering, before any screen reads colors. */
export function setThemeName(name: ThemeName) {
  current = name;
}

export function themeName() {
  return current;
}

/**
 * The active palette. Read it during render (not at module load) so it follows light/dark changes.
 */
export const colors: Palette = new Proxy({} as Palette, {
  get: (_, key) => palettes[current][key as keyof Palette],
});

/**
 * Like StyleSheet.create, but built per theme from the active palette. Read it during render.
 */
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: Palette) => T): T {
  const cache: Partial<Record<ThemeName, T>> = {};
  return new Proxy({} as T, {
    get: (_, key) => {
      const sheet = (cache[current] ??= StyleSheet.create(factory(palettes[current])));
      return sheet[key as keyof T];
    },
  });
}
