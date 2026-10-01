export type BikeType = 'scooter' | 'underbone' | 'manual' | 'bigbike';

export interface OdometerReading {
  date: string; // ISO
  km: number;
}

export interface MaintItem {
  id: string;
  key: string; // template key, or 'custom'
  name: string;
  description?: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  enabled: boolean;
  dismissed?: boolean; // rider hid it from recommendations
  lastKm: number;
  lastDate: string; // ISO
}

export interface Bike {
  id: string;
  name: string;
  make: string;
  model: string;
  year?: string;
  plate?: string;
  type: BikeType;
  odometer: number;
  readings: OdometerReading[];
  items: MaintItem[];
  createdAt: string;
}

export interface ServiceLog {
  id: string;
  bikeId: string;
  date: string; // ISO
  km: number;
  itemIds: string[];
  itemNames: string[]; // kept so history survives item renames/deletes
  cost: number | null;
  shop?: string;
  notes?: string;
}

export interface Settings {
  remindersEnabled: boolean;
  odometerReminder: boolean;
  fuelAlerts: boolean;
  theme: 'system' | 'light' | 'dark';
}

/** A built-in album id ('ride', 'service', 'parts', 'bike', 'other') or a CustomAlbum id. */
export type Album = string;

export interface CustomAlbum {
  id: string;
  label: string;
  icon: string;
}

export interface Photo {
  id: string;
  bikeId: string;
  kind?: 'photo' | 'video'; // missing = photo (older data)
  fileName: string; // inside the app's documents/photos folder
  thumbFileName?: string; // videos only: a saved frame for the grid
  duration?: number; // videos only, ms
  album: Album;
  caption?: string;
  date: string; // ISO
  width?: number;
  height?: number;
}

export interface Profile {
  fullName: string;
  photoFileName?: string; // in the app's photos folder
}

export interface Club {
  id: string;
  name: string;
  role?: string; // e.g. Member, Road Captain
  since?: string; // year joined
  logoFileName?: string; // in the app's photos folder
}
