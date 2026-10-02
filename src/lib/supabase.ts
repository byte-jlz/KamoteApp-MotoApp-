import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, FunctionsHttpError } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

// The login session is kept in AsyncStorage (already in the APK) so riders stay logged in between launches.
// Expo's guide uses expo-sqlite for this, but that is a native module and would need a new APK.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // phones have no URL to read a session from
  },
});

// Only refresh the session while the app is on screen.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Call an Edge Function. On failure, `error` is the function's error code (e.g. 'invalid_credentials') or 'network'. */
export async function callFunction<T>(name: string, body: object): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (!error) return { data: data ?? undefined };
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = (await error.context.json()) as { error?: string };
      return { error: payload.error ?? 'unknown' };
    } catch {
      return { error: 'unknown' };
    }
  }
  return { error: 'network' };
}
