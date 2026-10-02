import { useEffect } from 'react';
import { AppState } from 'react-native';
import { api, attachFriends, setIncomingCount } from './friends';

const EVERY_MS = 60_000;

/**
 * While the app is on screen and a rider is logged in, tell the server "I'm here" about once a minute
 * (the server stamps the time) and right away whenever the app comes back to the foreground.
 * Stops in the background; no background tasks. Pass null for guests.
 */
export function usePresence(userId: string | null) {
  useEffect(() => {
    attachFriends(userId);
    if (!userId) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const beat = async () => {
      const r = await api.heartbeat();
      if (r.ok && typeof r.data === 'number') setIncomingCount(r.data);
    };
    const start = () => {
      if (timer) return;
      beat();
      timer = setInterval(beat, EVERY_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => {
      sub.remove();
      stop();
    };
  }, [userId]);
}
