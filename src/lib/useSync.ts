import { useEffect, useSyncExternalStore } from 'react';
import { useStore } from './store';
import { attachSync, getSyncState, subscribeSync } from './sync';

/** Keep the logged-in rider's data in sync with the cloud while mounted. Pass null to stay offline-only. */
export function useCloudSync(userId: string | null) {
  const { storageKey, getData, applyRemote } = useStore();
  useEffect(() => {
    if (!userId) return;
    return attachSync({ userId, storageKey, getData, apply: applyRemote });
  }, [userId, storageKey, getData, applyRemote]);
}

export function useSyncState() {
  return useSyncExternalStore(subscribeSync, getSyncState);
}
