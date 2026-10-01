import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

/**
 * Two kinds of updates:
 *  - 'ota'  → JS/feature change published with `eas update`. Already downloaded; restart to apply.
 *  - 'apk'  → Native change that needs a new APK. Read from the hosted update-manifest.json.
 */
export type UpdateResult =
  | { kind: 'none' }
  | { kind: 'ota' }
  | { kind: 'apk'; latestVersion: string; downloadUrl: string; releaseNotes?: string; mandatory: boolean };

interface Manifest {
  latestVersion: string;
  minimumVersion?: string;
  downloadUrl: string;
  releaseNotes?: string;
}

const MANIFEST_URL: string = Constants.expoConfig?.extra?.updateManifestUrl ?? '';

export function currentVersion() {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';
}

/** Compare "1.2.10" vs "1.3.0" → negative if a < b. */
export function compareVersions(a: string, b: string) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function checkApk(): Promise<UpdateResult> {
  if (!MANIFEST_URL || Platform.OS !== 'android') return { kind: 'none' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return { kind: 'none' };
    const m = (await res.json()) as Manifest;
    const current = currentVersion();
    if (!m.latestVersion || !m.downloadUrl || compareVersions(current, m.latestVersion) >= 0) return { kind: 'none' };
    return {
      kind: 'apk',
      latestVersion: m.latestVersion,
      downloadUrl: m.downloadUrl,
      releaseNotes: m.releaseNotes,
      mandatory: !!m.minimumVersion && compareVersions(current, m.minimumVersion) < 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkOta(): Promise<UpdateResult> {
  // Only works in real builds (APK), not in Expo Go or `expo start`.
  if (__DEV__ || !Updates.isEnabled) return { kind: 'none' };
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) return { kind: 'none' };
  const fetched = await Updates.fetchUpdateAsync();
  return fetched.isNew ? { kind: 'ota' } : { kind: 'none' };
}

/** Check both update kinds. A required new APK takes priority over an OTA update. */
export async function checkForUpdates(): Promise<UpdateResult> {
  try {
    const apk = await checkApk();
    if (apk.kind !== 'none') return apk;
  } catch (e) {
    console.warn('APK update check failed', e);
  }
  try {
    return await checkOta();
  } catch (e) {
    console.warn('OTA update check failed', e);
    return { kind: 'none' };
  }
}

export function applyOtaUpdate() {
  return Updates.reloadAsync();
}

export function updateDetails() {
  return {
    version: currentVersion(),
    build: Application.nativeBuildVersion,
    channel: Updates.channel,
    updateId: Updates.isEmbeddedLaunch ? null : Updates.updateId,
    updatedAt: Updates.isEmbeddedLaunch ? null : Updates.createdAt,
  };
}
