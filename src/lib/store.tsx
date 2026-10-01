import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import { defaultItems } from './defaults';
import { uid } from './format';
import { rescheduleAll } from './notifications';
import { deleteMediaFile, makeVideoThumb, saveMediaFile } from './photos';
import { setThemeName, ThemeName } from './theme';
import { Album, Bike, BikeType, Club, CustomAlbum, MaintItem, Photo, Profile, ServiceLog, Settings } from './types';

const STORAGE_KEY = 'motopms:data:v1';
const MAX_READINGS = 60;

interface Data {
  bikes: Bike[];
  logs: ServiceLog[];
  photos: Photo[];
  albums: CustomAlbum[];
  profile: Profile;
  clubs: Club[];
  settings: Settings;
}

const EMPTY: Data = {
  bikes: [],
  logs: [],
  photos: [],
  albums: [],
  profile: { fullName: '' },
  clubs: [],
  settings: { remindersEnabled: true, odometerReminder: true, theme: 'system' },
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

function useStoreValue() {
  const [data, setData] = useState<Data>(EMPTY);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<Data>;
          setData({
            ...EMPTY,
            ...parsed,
            profile: { ...EMPTY.profile, ...parsed.profile },
            settings: { ...EMPTY.settings, ...parsed.settings },
          });
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
    }),
    [ready, themeName, data, addBike, editBike, deleteBike, updateOdometer, saveItem, deleteItem, trackItems, dismissItem, logService, deleteLog, addMedia, updatePhoto, deletePhoto, saveAlbum, deleteAlbum, updateProfile, saveClub, deleteClub, updateSettings],
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

/** Subscribe a component to light/dark changes (for ones that don't otherwise read the store). */
export function useThemeName() {
  return useStore().themeName;
}

export function useBike(id: string | undefined) {
  const { bikes } = useStore();
  return bikes.find((b) => b.id === id);
}
