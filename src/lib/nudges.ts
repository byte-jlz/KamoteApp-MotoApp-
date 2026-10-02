import AsyncStorage from '@react-native-async-storage/async-storage';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { router } from 'expo-router';
import { useSyncExternalStore } from 'react';
import { Alert, Platform } from 'react-native';
import { rpc, Result } from './friends';
import {
  ALARM_CATEGORY,
  ALARM_CHANNEL,
  devicePushToken,
  dismissNotification,
  dismissNotificationsWhere,
  ensurePermission,
  NotificationTap,
  NUDGE_CATEGORY,
  NUDGE_CHANNEL,
  presentNow,
  ReceivedNotification,
  setupNudgeNotifications,
} from './notifications';
import { supabase } from './supabase';

// 👋 Nudge, 🚨 Alarm and quick replies between friends. The rules (friends only, blocks, limits, mutes,
// one reply within 30 minutes) are enforced by the database; sending goes through the send-nudge Edge Function.

export type NudgeKind = 'nudge' | 'alarm';
export interface Reply {
  code: string;
  title: string;
}

export const MAX_MESSAGE = 100;
export const QUICK_MESSAGES = ['Ride na tayo!', 'Nasaan ka na?', 'Malapit na ako'];

export const NUDGE_REPLIES: Reply[] = [
  { code: 'thumbs_up', title: '👍' },
  { code: 'on_my_way', title: 'On my way' },
  { code: 'wait_for_me', title: 'Wait for me' },
];
export const ALARM_REPLIES: Reply[] = [
  { code: 'on_my_way', title: 'On my way' },
  { code: 'five_minutes', title: '5 minutes' },
  { code: 'running_late', title: 'Running late' },
  { code: 'cant_make_it', title: 'Can’t make it' },
];
// Android shows at most 3 buttons on a notification, so "Running late" is offered in the app only.
const ALARM_NOTIFICATION_REPLIES = ALARM_REPLIES.filter((r) => r.code !== 'running_late');

export const repliesFor = (kind: string) => (kind === 'alarm' ? ALARM_REPLIES : NUDGE_REPLIES);
export const replyLabel = (code: string | null | undefined) =>
  [...NUDGE_REPLIES, ...ALARM_REPLIES].find((r) => r.code === code)?.title ?? '';

// ── Server ──

export type SendResult =
  | { ok: true; status: 'sent' | 'no_device' }
  | { ok: false; error: string; retryAfter?: number };

async function invoke(body: object): Promise<SendResult> {
  try {
    const { data, error } = await supabase.functions.invoke<{ status: 'sent' | 'no_device' }>('send-nudge', { body });
    if (!error) return { ok: true, status: data?.status === 'no_device' ? 'no_device' : 'sent' };
    if (error instanceof FunctionsHttpError) {
      try {
        const payload = (await error.context.json()) as { error?: string; retry_after?: number };
        return { ok: false, error: payload.error ?? 'unknown', retryAfter: payload.retry_after };
      } catch {
        return { ok: false, error: 'unknown' };
      }
    }
    return { ok: false, error: 'network' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

function waitText(seconds = 60) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** What to tell the rider when sending or replying didn't work. */
export function sendErrorText(r: { error: string; retryAfter?: number }) {
  switch (r.error) {
    case 'network':
      return 'No internet connection. Try again when you’re online.';
    case 'rate_limited':
      return `Slow down a little. You can send again in ${waitText(r.retryAfter)}.`;
    case 'not_allowed':
      return 'You can only nudge and answer friends.';
    case 'expired':
      return 'This nudge is more than 30 minutes old, so it can’t be answered anymore.';
    case 'already_replied':
      return 'You already answered this one.';
    case 'message_too_long':
      return `Messages can be up to ${MAX_MESSAGE} characters.`;
    case 'not_logged_in':
      return 'Please log in again.';
    default:
      return 'Couldn’t send it. Please try again.';
  }
}

export interface NudgeCard {
  muted: boolean;
  lastReplyCode: string | null;
  lastReplyAt: string | null;
  openNudgeId: string | null;
  openNudgeKind: NudgeKind | null;
  openNudgeAt: string | null;
}

type CardRow = {
  muted: boolean;
  last_reply_code: string | null;
  last_reply_at: string | null;
  open_nudge_id: string | null;
  open_nudge_kind: NudgeKind | null;
  open_nudge_at: string | null;
};

export const nudgeApi = {
  send: (receiverId: string, kind: NudgeKind, message: string) =>
    invoke({ action: kind, receiver_id: receiverId, message: message.trim() || undefined }),
  getCard: async (riderId: string): Promise<Result<NudgeCard>> => {
    const r = await rpc<CardRow[]>('get_nudge_card', { p_rider: riderId });
    if (!r.ok) return r;
    const x = r.data?.[0];
    return {
      ok: true,
      data: {
        muted: !!x?.muted,
        lastReplyCode: x?.last_reply_code ?? null,
        lastReplyAt: x?.last_reply_at ?? null,
        openNudgeId: x?.open_nudge_id ?? null,
        openNudgeKind: x?.open_nudge_kind ?? null,
        openNudgeAt: x?.open_nudge_at ?? null,
      },
    };
  },
  setMute: (riderId: string, muted: boolean) => rpc<boolean>('set_nudge_mute', { p_rider: riderId, p_muted: muted }),
  getSettings: async (): Promise<Result<{ allowNudges: boolean; allowAlarms: boolean }>> => {
    const r = await rpc<{ allow_nudges: boolean; allow_alarms: boolean }[]>('get_nudge_settings');
    if (!r.ok) return r;
    return { ok: true, data: { allowNudges: r.data?.[0]?.allow_nudges ?? true, allowAlarms: r.data?.[0]?.allow_alarms ?? true } };
  },
  setSettings: async (allowNudges: boolean, allowAlarms: boolean): Promise<Result<{ allowNudges: boolean; allowAlarms: boolean }>> => {
    const r = await rpc<{ allow_nudges: boolean; allow_alarms: boolean }[]>('set_nudge_settings', {
      p_allow_nudges: allowNudges,
      p_allow_alarms: allowAlarms,
    });
    if (!r.ok) return r;
    return { ok: true, data: { allowNudges: r.data?.[0]?.allow_nudges ?? allowNudges, allowAlarms: r.data?.[0]?.allow_alarms ?? allowAlarms } };
  },
};

/** Answer a nudge/alarm with a fixed reply. Removes its notification and refreshes open rider cards. */
export async function sendReply(nudgeId: string, code: string): Promise<SendResult> {
  const r = await invoke({ action: 'reply', nudge_id: nudgeId, code });
  if (r.ok || r.error === 'already_replied' || r.error === 'expired') {
    dismissNotificationsWhere((d) => d.nudge_id === nudgeId);
    if (banner?.nudgeId === nudgeId) hideBanner();
    emitActivity();
  }
  return r;
}

// ── "Something changed" signal for open rider cards (a reply arrived, I answered) ──

const activityListeners = new Set<() => void>();
const emitActivity = () => activityListeners.forEach((l) => l());
export function onNudgeActivity(l: () => void) {
  activityListeners.add(l);
  return () => {
    activityListeners.delete(l);
  };
}

// ── In-app banner (top of the screen) ──

export interface Banner {
  key: number;
  kind: NudgeKind | 'reply' | 'info';
  title: string;
  body: string;
  riderId?: string;
  nudgeId?: string;
}

let banner: Banner | null = null;
let bannerKey = 0;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;
const bannerListeners = new Set<() => void>();

export function showBanner(b: Omit<Banner, 'key'>) {
  if (bannerTimer) clearTimeout(bannerTimer);
  banner = { ...b, key: ++bannerKey };
  bannerListeners.forEach((l) => l());
  // Alarms stay until answered or closed; everything else goes away by itself.
  if (b.kind !== 'alarm') bannerTimer = setTimeout(hideBanner, b.kind === 'info' ? 4000 : 20000);
}

export function hideBanner() {
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = null;
  banner = null;
  bannerListeners.forEach((l) => l());
}

export function useBanner() {
  return useSyncExternalStore(
    (l) => {
      bannerListeners.add(l);
      return () => bannerListeners.delete(l);
    },
    () => banner,
  );
}

// ── Notifications ──

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const isNudge = (d: Record<string, unknown>) =>
  d.screen === 'rider' && (d.kind === 'nudge' || d.kind === 'alarm' || d.kind === 'reply');

/**
 * A nudge, alarm or reply arrived while the app is open. Android doesn't show data-only pushes then, so show it
 * ourselves on the right channel (sound, alarm volume, reply buttons) plus the in-app banner.
 */
export async function handleIncoming(n: ReceivedNotification) {
  const d = n.data;
  if (!isNudge(d) || d.local) return; // `local`: our own copy below
  const kind = d.kind as Banner['kind'];
  await presentNow({
    title: n.title,
    body: n.body,
    data: { ...d, local: true },
    channelId: kind === 'alarm' ? ALARM_CHANNEL : NUDGE_CHANNEL,
    categoryId: kind === 'alarm' ? ALARM_CATEGORY : kind === 'nudge' ? NUDGE_CATEGORY : undefined,
  });
  showBanner({ kind, title: n.title, body: n.body, riderId: str(d.rider_id), nudgeId: str(d.nudge_id) });
  emitActivity();
}

/** A nudge notification (or one of its reply buttons) was tapped. Returns false if it isn't a nudge. */
export async function handleNudgeTap(t: NotificationTap) {
  if (!isNudge(t.data)) return false;
  const nudgeId = str(t.data.nudge_id);
  const riderId = str(t.data.rider_id);
  if (t.action && nudgeId) {
    // A reply button: the app was opened to send it.
    dismissNotification(t.id);
    const r = await sendReply(nudgeId, t.action);
    showBanner(
      r.ok
        ? { kind: 'info', title: `✅ Reply sent: ${replyLabel(t.action)}`, body: '' }
        : { kind: 'info', title: '⚠️ Reply not sent', body: sendErrorText(r) },
    );
    return true;
  }
  if (riderId) router.push({ pathname: '/rider/[id]', params: { id: riderId } });
  return true;
}

// ── This phone ↔ account ──

const UNLINK_KEY = 'motopms:nudgeUnlinkPending:v1';
const TIP_KEY = 'motopms:alarmTipSeen:v1';

/** Channels and reply buttons; safe to call often. */
export function setupNudges() {
  return setupNudgeNotifications(NUDGE_REPLIES, ALARM_NOTIFICATION_REPLIES).catch((e) => console.warn('Nudge setup failed', e));
}

/** Link this phone to the logged-in account so it gets nudges (after login and on every app start). */
export async function linkThisPhone() {
  if (Platform.OS !== 'android') return false;
  await setupNudges(); // channels must exist before the token is requested
  const token = await devicePushToken();
  if (!token) return false;
  const r = await rpc<null>('link_device', { p_token: token, p_platform: 'android' });
  if (r.ok) AsyncStorage.removeItem(UNLINK_KEY).catch(() => {});
  return r.ok;
}

/** Stop nudges to this phone (log out). Retried on the next app start if it fails, e.g. no internet. */
export async function unlinkThisPhone() {
  if (Platform.OS !== 'android') return;
  const token = await devicePushToken();
  if (!token) return;
  const r = await Promise.race([
    rpc<null>('unlink_device', { p_token: token }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
  if (!r?.ok) await AsyncStorage.setItem(UNLINK_KEY, '1').catch(() => {});
}

/** A log out that couldn't reach the server: try again (works without a login). */
export async function retryPendingUnlink() {
  try {
    if (!(await AsyncStorage.getItem(UNLINK_KEY))) return;
    const token = await devicePushToken();
    const r = token ? await rpc<null>('unlink_device', { p_token: token }) : null;
    if (!token || r?.ok) await AsyncStorage.removeItem(UNLINK_KEY);
  } catch {
    /* next start */
  }
}

/**
 * One-time tip: many phones stop apps that are swiped away, which can stop nudges. Shown the first time nudges
 * are switched on for this phone (first link, or turning a switch on). `askPermission`: also ask to allow
 * notifications (Android 13+) that one time, so a rider who said no isn't asked on every start.
 */
export async function showAlarmTipOnce(askPermission = false) {
  if (Platform.OS !== 'android') return;
  try {
    if (await AsyncStorage.getItem(TIP_KEY)) return;
    await AsyncStorage.setItem(TIP_KEY, '1');
  } catch {
    return;
  }
  if (askPermission) await ensurePermission();
  Alert.alert(
    'Get every nudge and alarm',
    'Friends can now nudge you. Some phones (Xiaomi, Redmi, POCO, OPPO, realme, vivo, Infinix, TECNO…) stop apps that you swipe away, and then nudges don’t show. It takes a minute to fix.',
    [
      { text: 'Later', style: 'cancel' },
      { text: 'Show me how', onPress: () => router.push('/nudge-help') },
    ],
  );
}
