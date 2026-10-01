import { useEffect, useSyncExternalStore } from 'react';
import { getFuelState, refreshFuel, subscribeFuel } from './fuel';

/** Current fuel data (shared app-wide); fetches on first use and when the cached copy is stale. */
export function useFuel() {
  const s = useSyncExternalStore(subscribeFuel, getFuelState);
  useEffect(() => {
    refreshFuel();
  }, []);
  return s;
}
