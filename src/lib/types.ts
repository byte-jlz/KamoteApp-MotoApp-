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
}
