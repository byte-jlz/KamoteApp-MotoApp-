import AsyncStorage from '@react-native-async-storage/async-storage';
import { Bike, Club, CustomAlbum, Photo, Profile, ServiceLog, Settings } from './types';

/** Everything the app keeps on the phone, saved as one JSON blob per mode (guest, or each account). */
export interface Data {
  bikes: Bike[];
  logs: ServiceLog[];
  photos: Photo[];
  albums: CustomAlbum[];
  profile: Profile;
  clubs: Club[];
  settings: Settings;
}

export const EMPTY: Data = {
  bikes: [],
  logs: [],
  photos: [],
  albums: [],
  profile: { fullName: '' },
  clubs: [],
  settings: { remindersEnabled: true, odometerReminder: true, fuelAlerts: true, theme: 'system' },
};

// Guest data has always lived under this key; keep it so existing riders' data loads unchanged.
export const GUEST_KEY = 'motopms:data:v1';

/** Where the app's data lives on the phone: the guest copy, or a logged-in account's copy. */
export function dataKeyFor(userId?: string | null) {
  return userId ? `${GUEST_KEY}:user:${userId}` : GUEST_KEY;
}

/** Saved JSON → Data, filling in anything older saves don't have. */
export function parseData(raw: string | null): Data {
  if (!raw) return EMPTY;
  const parsed = JSON.parse(raw) as Partial<Data>;
  return {
    ...EMPTY,
    ...parsed,
    profile: { ...EMPTY.profile, ...parsed.profile },
    settings: { ...EMPTY.settings, ...parsed.settings },
  };
}

export async function readData(storageKey: string): Promise<Data> {
  return parseData(await AsyncStorage.getItem(storageKey));
}
