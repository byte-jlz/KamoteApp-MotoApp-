import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { defaultItems } from './defaults';
import { uid } from './format';
import { rescheduleAll } from './notifications';
import { Bike, BikeType, MaintItem, ServiceLog, Settings } from './types';

const STORAGE_KEY = 'motopms:data:v1';
const MAX_READINGS = 60;

interface Data {
  bikes: Bike[];
  logs: ServiceLog[];
  settings: Settings;
}

const EMPTY: Data = {
  bikes: [],
  logs: [],
  settings: { remindersEnabled: true, odometerReminder: true },
};

export interface NewBike {
  name: string;
  make: string;
  model: string;
  year?: string;
  plate?: string;
  type: BikeType;
  odometer: number;
}

export interface NewLog {
  date: string;
  km: number;
  itemIds: string[];
  cost: number | null;
  shop?: string;
  notes?: string;
}

function addReading(bike: Bike, km: number, date: string): Bike {
  const readings = [...bike.readings, { km, date }]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_READINGS);
  return { ...bike, readings };
}

function useStoreValue() {
  const [data, setData] = useState<Data>(EMPTY);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<Data>;
          setData({ ...EMPTY, ...parsed, settings: { ...EMPTY.settings, ...parsed.settings } });
        }
      })
      .catch((e) => console.warn('Failed to load data', e))
      .finally(() => setReady(true));
  }, []);

  // Persist and refresh reminders after changes (debounced).
  useEffect(() => {
    if (!ready) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch((e) => console.warn('Failed to save', e));
      rescheduleAll(data.bikes, data.settings);
    }, 500);
  }, [data, ready]);

  const updateBikeById = useCallback((id: string, fn: (b: Bike) => Bike) => {
    setData((d) => ({ ...d, bikes: d.bikes.map((b) => (b.id === id ? fn(b) : b)) }));
  }, []);

  const addBike = useCallback((nb: NewBike) => {
    const now = new Date().toISOString();
    const bike: Bike = {
      id: uid(),
      name: nb.name,
      make: nb.make,
      model: nb.model,
      year: nb.year,
      plate: nb.plate,
      type: nb.type,
      odometer: nb.odometer,
      readings: [{ km: nb.odometer, date: now }],
      items: defaultItems(nb.type, nb.odometer, now),
      createdAt: now,
    };
    setData((d) => ({ ...d, bikes: [...d.bikes, bike] }));
    return bike.id;
  }, []);

  const editBike = useCallback(
    (id: string, patch: Partial<Pick<Bike, 'name' | 'make' | 'model' | 'year' | 'plate' | 'type'>>) =>
      updateBikeById(id, (b) => ({ ...b, ...patch })),
    [updateBikeById],
  );

  const deleteBike = useCallback((id: string) => {
    setData((d) => ({ ...d, bikes: d.bikes.filter((b) => b.id !== id), logs: d.logs.filter((l) => l.bikeId !== id) }));
  }, []);

  const updateOdometer = useCallback(
    (id: string, km: number) =>
      updateBikeById(id, (b) => addReading({ ...b, odometer: km }, km, new Date().toISOString())),
    [updateBikeById],
  );

  const saveItem = useCallback(
    (bikeId: string, item: Omit<MaintItem, 'id'> & { id?: string }) => {
      const id = item.id ?? uid();
      updateBikeById(bikeId, (b) => {
        const exists = b.items.some((i) => i.id === id);
        const full = { ...item, id } as MaintItem;
        return { ...b, items: exists ? b.items.map((i) => (i.id === id ? full : i)) : [...b.items, full] };
      });
      return id;
    },
    [updateBikeById],
  );

  const deleteItem = useCallback(
    (bikeId: string, itemId: string) =>
      updateBikeById(bikeId, (b) => ({ ...b, items: b.items.filter((i) => i.id !== itemId) })),
    [updateBikeById],
  );

  const logService = useCallback((bikeId: string, nl: NewLog) => {
    setData((d) => {
      const bike = d.bikes.find((b) => b.id === bikeId);
      if (!bike) return d;
      const log: ServiceLog = {
        id: uid(),
        bikeId,
        ...nl,
        itemNames: bike.items.filter((i) => nl.itemIds.includes(i.id)).map((i) => i.name),
      };
      let updated: Bike = {
        ...bike,
        items: bike.items.map((i) => {
          if (!nl.itemIds.includes(i.id)) return i;
          // Only move "last done" forward; logging an older service shouldn't reset a newer one.
          if (new Date(nl.date) < new Date(i.lastDate) && nl.km < i.lastKm) return i;
          return { ...i, lastKm: nl.km, lastDate: nl.date };
        }),
      };
      if (nl.km > bike.odometer) updated = addReading({ ...updated, odometer: nl.km }, nl.km, nl.date);
      return { ...d, bikes: d.bikes.map((b) => (b.id === bikeId ? updated : b)), logs: [log, ...d.logs] };
    });
  }, []);

  const deleteLog = useCallback((logId: string) => {
    setData((d) => ({ ...d, logs: d.logs.filter((l) => l.id !== logId) }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  }, []);

  return useMemo(
    () => ({
      ready,
      ...data,
      addBike,
      editBike,
      deleteBike,
      updateOdometer,
      saveItem,
      deleteItem,
      logService,
      deleteLog,
      updateSettings,
    }),
    [ready, data, addBike, editBike, deleteBike, updateOdometer, saveItem, deleteItem, logService, deleteLog, updateSettings],
  );
}

type Store = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue();
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore must be used inside StoreProvider');
  return s;
}

export function useBike(id: string | undefined) {
  const { bikes } = useStore();
  return bikes.find((b) => b.id === id);
}
