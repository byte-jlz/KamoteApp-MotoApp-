import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { Bike, Settings } from './types';
import { itemStatus } from './status';

type NotificationsModule = typeof import('expo-notifications');

const CHANNEL = 'pms-reminders';
const REMINDER_HOUR = 9; // reminders fire at 9:00 AM
const MAX_SCHEDULED = 50; // iOS keeps at most 64 pending local notifications
const DAY = 86_400_000;

// Expo Go on Android (SDK 53+) throws as soon as expo-notifications is imported,
// so the module is only loaded where it works: web has no notifications at all,
// and Expo Go on Android needs a development build / APK instead.
const isExpoGoAndroid =
  Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const notificationsSupported = Platform.OS !== 'web' && !isExpoGoAndroid;

export const notificationsUnavailableReason =
  Platform.OS === 'web'
    ? 'Notifications are not available in the browser preview.'
    : 'Notifications are not available in Expo Go on Android. They will work in the installed app (APK / development build).';

let cached: NotificationsModule | null = null;

function getModule(): NotificationsModule | null {
  if (!notificationsSupported) return null;
  if (!cached) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cached = require('expo-notifications') as NotificationsModule;
    } catch (e) {
      console.warn('expo-notifications unavailable', e);
      return null;
    }
  }
  return cached;
}

export function configureNotifications() {
  const N = getModule();
  if (!N) return;
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function ensureChannel(N: NotificationsModule) {
  if (Platform.OS === 'android') {
    await N.setNotificationChannelAsync(CHANNEL, {
      name: 'Maintenance reminders',
      importance: N.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#EA580C',
    });
  }
}

/** Ask for permission if needed. Returns whether notifications are allowed. */
export async function ensurePermission(): Promise<boolean> {
  const N = getModule();
  if (!N) return false;
  await ensureChannel(N);
  const current = await N.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const req = await N.requestPermissionsAsync();
  return req.granted;
}

function atReminderHour(d: Date) {
  const r = new Date(d);
  r.setHours(REMINDER_HOUR, 0, 0, 0);
  return r;
}

interface Pending {
  date: Date;
  title: string;
  body: string;
}

let queue: Promise<void> = Promise.resolve();

/**
 * Rebuild every scheduled reminder from the current data. Called whenever bikes
 * or settings change; calls are serialized so they never interleave.
 */
export function rescheduleAll(bikes: Bike[], settings: Settings) {
  const N = getModule();
  if (!N) return Promise.resolve();
  queue = queue.then(() => doReschedule(N, bikes, settings)).catch((e) => console.warn('reschedule failed', e));
  return queue;
}

async function doReschedule(N: NotificationsModule, bikes: Bike[], settings: Settings) {
  await N.cancelAllScheduledNotificationsAsync();
  if (!settings.remindersEnabled) return;
  const perm = await N.getPermissionsAsync();
  if (!perm.granted) return;
  await ensureChannel(N);

  const now = new Date();
  const tomorrow = atReminderHour(new Date(now.getTime() + DAY));
  const pending: Pending[] = [];

  for (const bike of bikes) {
    for (const item of bike.items) {
      const s = itemStatus(bike, item, now);
      if (s.status === 'off' || !s.estDate) continue;

      if (s.status === 'overdue') {
        pending.push({
          date: tomorrow,
          title: `⚠️ ${item.name} overdue`,
          body: `${bike.name} is overdue for ${item.name.toLowerCase()}. Schedule your PMS soon.`,
        });
        continue;
      }

      const due = atReminderHour(s.estDate);
      const weekBefore = new Date(due.getTime() - 7 * DAY);
      if (weekBefore > now) {
        pending.push({
          date: weekBefore,
          title: `🔧 ${item.name} due in about a week`,
          body: `${bike.name}: plan your ${item.name.toLowerCase()} soon.`,
        });
      }
      if (due > now) {
        pending.push({
          date: due,
          title: `🔧 ${item.name} due`,
          body: `${bike.name} is due for ${item.name.toLowerCase()}. Ride safe!`,
        });
      }
    }
  }

  pending.sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const p of pending.slice(0, MAX_SCHEDULED)) {
    await N.scheduleNotificationAsync({
      content: { title: p.title, body: p.body, sound: true },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: p.date, channelId: CHANNEL },
    });
  }

  if (settings.odometerReminder && bikes.length > 0) {
    await N.scheduleNotificationAsync({
      content: {
        title: '🏍️ Update your odometer',
        body: 'Log your current mileage so MotoPMS can keep your service reminders accurate.',
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.WEEKLY,
        weekday: 1, // Sunday
        hour: 18,
        minute: 0,
        channelId: CHANNEL,
      },
    });
  }
}

export async function sendTestNotification() {
  const N = getModule();
  if (!N || !(await ensurePermission())) return false;
  await N.scheduleNotificationAsync({
    content: { title: '🔧 MotoPMS test', body: 'Reminders are working. Ride safe!' },
    trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3, channelId: CHANNEL },
  });
  return true;
}
