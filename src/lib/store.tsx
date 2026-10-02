import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import { defaultItems } from './defaults';
import { uid } from './format';
import { rescheduleAll } from './notifications';
import { deleteMediaFile, makeVideoThumb, saveMediaFile } from './photos';
import { Data, EMPTY, parseData } from './localData';
import { trackSaved } from './sync';
import { setThemeName, ThemeName } from './theme';
import { Album, Bike, BikeType, Club, CustomAlbum, MaintItem, Photo, ServiceLog, Settings } from './types';

const MAX_READINGS = 60;

/** Save the data and note what changed, for cloud sync (guests too, so their records get change dates). */
async function save(storageKey: string, data: Data) {
  try {
    await AsyncStorage.setItem(storageKey, JSON.stringify(data));
    await trackSaved(storageKey, data);
  } catch (e) {
    console.warn('Failed to save', e);
  }
}

// The mounted store's "save now" (login and logout move data between storage keys, so it must be on disk first).
let activeFlush: (() => Promise<void>) | null = null;

/** Write any change still waiting on the save debounce. */
export function flushStore() {
  return activeFlush ? activeFlush() : Promise.resolve();
}

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

export interface PickedAsset {
  uri: string;
  type?: string | null;
  width?: number;
  height?: number;
  duration?: number | null;
}

function addReading(bike: Bike, km: number, date: string): Bike {
  const readings = [...bike.readings, { km, date }]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_READINGS);
  return { ...bike, readings };
}

function useStoreValue(storageKey: string) {
  const [data, setData] = useState<Data>(EMPTY);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(data); // the newest data: what the pending save will write, and what sync reads

  useEffect(() => {
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (raw) setData(parseData(raw));
      })
      .catch((e) => console.warn('Failed to load data', e))
      .finally(() => setReady(true));
  }, [storageKey]);

  // Logging in or out swaps the store; save any change still waiting on the debounce first.
  useEffect(() => {
    const flush = async () => {
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await save(storageKey, latest.current);
    };
    activeFlush = flush;
    return () => {
      if (activeFlush === flush) activeFlush = null;
      flush();
    };
  }, [storageKey]);

  // Persist and refresh reminders after changes (debounced).
  useEffect(() => {
    if (!ready) return;
    latest.current = data;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      save(storageKey, data);
      rescheduleAll(data.bikes, data.settings);
    }, 500);
  }, [data, ready, storageKey]);

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
    setData((d) => {
      d.photos
        .filter((p) => p.bikeId === id)
        .forEach((p) => {
          deleteMediaFile(p.fileName);
          deleteMediaFile(p.thumbFileName);
        });
      return {
        ...d,
        bikes: d.bikes.filter((b) => b.id !== id),
        logs: d.logs.filter((l) => l.bikeId !== id),
        photos: d.photos.filter((p) => p.bikeId !== id),
      };
    });
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

  /** Start tracking items. Ones never logged restart from today's odometer so they aren't instantly overdue. */
  const trackItems = useCallback((bikeId: string, itemIds: string[]) => {
    setData((d) => ({
      ...d,
      bikes: d.bikes.map((b) => {
        if (b.id !== bikeId) return b;
        const now = new Date().toISOString();
        return {
          ...b,
          items: b.items.map((i) => {
            if (!itemIds.includes(i.id)) return i;
            const logged = d.logs.some((l) => l.bikeId === bikeId && l.itemIds.includes(i.id));
            return { ...i, enabled: true, dismissed: false, ...(logged ? {} : { lastKm: b.odometer, lastDate: now }) };
          }),
        };
      }),
    }));
  }, []);

  const dismissItem = useCallback(
    (bikeId: string, itemId: string) =>
      updateBikeById(bikeId, (b) => ({ ...b, items: b.items.map((i) => (i.id === itemId ? { ...i, dismissed: true } : i)) })),
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

  /** Copies picked photos/videos into the phone's app storage, then records them. Resolves to how many were saved. */
  const addMedia = useCallback(async (bikeId: string, album: Album, assets: PickedAsset[]) => {
    const now = new Date().toISOString();
    const added: Photo[] = [];
    for (const a of assets) {
      try {
        const video = a.type === 'video';
        const fileName = saveMediaFile(a.uri, video ? '.mp4' : '.jpg');
        added.push({
          id: uid(),
          bikeId,
          album,
          date: now,
          kind: video ? 'video' : 'photo',
          fileName,
          thumbFileName: video ? await makeVideoThumb(fileName) : undefined,
          duration: video ? (a.duration ?? undefined) : undefined,
          width: a.width,
          height: a.height,
        });
      } catch (e) {
        console.warn('Failed to save media', e);
      }
    }
    setData((d) => ({ ...d, photos: [...added, ...d.photos] }));
    return added.length;
  }, []);

  const updatePhoto = useCallback((id: string, patch: Partial<Pick<Photo, 'album' | 'caption' | 'thumbFileName' | 'bikeId'>>) => {
    setData((d) => ({ ...d, photos: d.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  }, []);

  const deletePhoto = useCallback((id: string) => {
    setData((d) => {
      const photo = d.photos.find((p) => p.id === id);
      deleteMediaFile(photo?.fileName);
      deleteMediaFile(photo?.thumbFileName);
      return { ...d, photos: d.photos.filter((p) => p.id !== id) };
    });
  }, []);

  const saveAlbum = useCallback((album: Omit<CustomAlbum, 'id'> & { id?: string }) => {
    const id = album.id ?? uid();
    setData((d) => {
      const full = { ...album, id };
      const exists = d.albums.some((a) => a.id === id);
      return { ...d, albums: exists ? d.albums.map((a) => (a.id === id ? full : a)) : [...d.albums, full] };
    });
    return id;
  }, []);

  /** Removes a custom category; its photos move to "Other" rather than being deleted. */
  const deleteAlbum = useCallback((id: string) => {
    setData((d) => ({
      ...d,
      albums: d.albums.filter((a) => a.id !== id),
      photos: d.photos.map((p) => (p.album === id ? { ...p, album: 'other' } : p)),
    }));
  }, []);

  /** Pass `newPhotoUri` (a freshly picked image) to replace the photo, or null to remove it. */
  const updateProfile = useCallback((fullName: string, newPhotoUri?: string | null) => {
    const photoFileName = newPhotoUri ? saveMediaFile(newPhotoUri) : undefined;
    setData((d) => {
      const changing = newPhotoUri !== undefined;
      if (changing) deleteMediaFile(d.profile.photoFileName);
      return { ...d, profile: { fullName, photoFileName: changing ? photoFileName : d.profile.photoFileName } };
    });
  }, []);

  /** Pass `newLogoUri` (a freshly picked image) to replace the logo, or null to remove it. */
  const saveClub = useCallback((club: Omit<Club, 'id' | 'logoFileName'> & { id?: string }, newLogoUri?: string | null) => {
    const id = club.id ?? uid();
    const logoFileName = newLogoUri ? saveMediaFile(newLogoUri) : undefined;
    setData((d) => {
      const prev = d.clubs.find((c) => c.id === id);
      const changing = newLogoUri !== undefined;
      if (changing) deleteMediaFile(prev?.logoFileName);
      const full: Club = { ...club, id, logoFileName: changing ? logoFileName : prev?.logoFileName };
      return { ...d, clubs: prev ? d.clubs.map((c) => (c.id === id ? full : c)) : [...d.clubs, full] };
    });
    return id;
  }, []);

  const deleteClub = useCallback((id: string) => {
    setData((d) => {
      deleteMediaFile(d.clubs.find((c) => c.id === id)?.logoFileName);
      return { ...d, clubs: d.clubs.filter((c) => c.id !== id) };
    });
  }, []);

  /** Cloud sync: apply changes downloaded from the server, and delete media files they made unused. */
  const applyRemote = useCallback((fn: (d: Data) => { data: Data; removedMedia: string[] }) => {
    setData((d) => {
      const r = fn(d);
      r.removedMedia.forEach(deleteMediaFile);
      return r.data;
    });
  }, []);

  /** Cloud sync: the data as last rendered. */
  const getData = useCallback(() => latest.current, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  }, []);

  // Resolve light/dark here so a change re-renders every screen that uses the store.
  const system = useColorScheme();
  const themeName: ThemeName =
    data.settings.theme === 'system' ? (system === 'dark' ? 'dark' : 'light') : data.settings.theme;
  setThemeName(themeName);

  return useMemo(
    () => ({
      ready,
      themeName,
      ...data,
      addBike,
      editBike,
      deleteBike,
      updateOdometer,
      saveItem,
      deleteItem,
      trackItems,
      dismissItem,
      logService,
      deleteLog,
      addMedia,
      updatePhoto,
      deletePhoto,
      saveAlbum,
      deleteAlbum,
      updateProfile,
      saveClub,
      deleteClub,
      updateSettings,
      storageKey,
      applyRemote,
      getData,
    }),
    [storageKey, applyRemote, getData, ready, themeName, data, addBike, editBike, deleteBike, updateOdometer, saveItem, deleteItem, trackItems, dismissItem, logService, deleteLog, addMedia, updatePhoto, deletePhoto, saveAlbum, deleteAlbum, updateProfile, saveClub, deleteClub, updateSettings],
  );
}

type Store = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<Store | null>(null);

/** Remount (pass `key={storageKey}`) when the storage key changes, so no data from the other mode lingers. */
export function StoreProvider({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const value = useStoreValue(storageKey);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const s = useContext(StoreContext);
  if (!s) throw new Error('useStore must be used inside StoreProvider');
  return s;
}

/** Subscribe a component to light/dark changes (for ones that don't otherwise read the store). */
export function useThemeName() {
  return useStore().themeName;
}

export function useBike(id: string | undefined) {
  const { bikes } = useStore();
  return bikes.find((b) => b.id === id);
}
