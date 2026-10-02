# MotoMonitor roadmap

Planned features that need a **new APK** (or, where marked, can ship as an over-the-air update).
Anything that adds a native package, a permission, a sound file or other `app.json` changes changes the
fingerprint, so it can't go out with `eas update`. Riders must install the new APK.

Android notification channels can't change their sound, vibration or importance after they're created. Any
change to how alarms sound needs a **new channel id** (for example `ride-alarms-v2`), plus a matching
`channelId` in the `send-nudge` Edge Function.

## Alarm nudges

### Custom alarm sound (e.g. motorcycle horn)
- **What:** Ride alarms play a short horn sound instead of the phone's default sound.
- **Native change:** bundle the sound file with the `expo-notifications` config plugin (`sounds` option in
  `app.json`), which copies it into the APK's `res/raw`. Create a new channel (e.g. `ride-alarms-horn`) with
  `sound: 'horn.wav'`, and send that `channelId` (and `sound`) from `send-nudge`.
- **Permission:** none.

### Alarm that rings in silent mode / Do Not Disturb
- **What:** a ride alarm still rings when the phone is silenced or in Do Not Disturb, if the rider allows it.
- **Native change:** add `android.permission.ACCESS_NOTIFICATION_POLICY` (`android.permissions` in `app.json`).
  Create a new alarm channel with `bypassDnd: true`. Add a screen that sends the rider to Android's
  "Do Not Disturb access" settings, because Android ignores `bypassDnd` until the rider grants it.
- **Permission:** Do Not Disturb access, granted by the rider in system settings. It can't be asked for with a
  normal pop-up.
- **Note:** today's `ride-alarms` channel already plays at alarm volume, which many phones still play on
  vibrate or silent. Do Not Disturb still blocks it.

### Full-screen alarm that rings until dismissed
- **What:** like a phone call or clock alarm, the screen turns on over the lock screen and the sound repeats
  until the rider answers or dismisses it.
- **Native change:** a native module or config plugin (not available in Expo's bundled modules) that builds the
  notification with a full-screen intent and `FLAG_INSISTENT`, plus an activity that can show over the lock
  screen (`showWhenLocked`, `turnScreenOn`). It probably also needs `expo-task-manager` (below), so the alarm
  can be built while the app is closed.
- **Permission:** `USE_FULL_SCREEN_INTENT`. From Android 14 it's only granted automatically to calling and
  alarm-clock apps; otherwise the rider must allow it in settings. Google Play also requires a policy
  declaration for it.

### Reply buttons without opening the app (needs expo-task-manager)
- **What:** tapping "On my way" on a nudge or alarm sends the reply in the background, without opening
  MotoMonitor. Today every reply button opens the app (`opensAppToForeground: true`), which then sends the
  reply.
- **Native change:** add `expo-task-manager` (a native module) and register a background notification task
  (`Notifications.registerTaskAsync`). Set the reply actions to `opensAppToForeground: false`. In the task, call
  `send-nudge` with the saved login, then dismiss the notification. Test it on phones that kill swiped-away
  apps (Xiaomi, OPPO, vivo, Infinix, TECNO), because the task can't run if the system has stopped the app.
- **Permission:** none.

## Rides

### Create a ride + automatic reminders (pg_cron)
- **What:** create a ride (time, meeting place, invited friends). Invited friends accept or decline, and
  everyone gets reminders (e.g. 1 day and 1 hour before).
- **Native change:** **none: this can ship over the air.** It uses the existing `nudges` channel and the
  `send-nudge` delivery code.
- **Server:** new tables (`rides`, `ride_invites`) with the same friends-only and blocks rules. Enable the
  `pg_cron` and `pg_net` extensions in Supabase. A cron job runs every minute and calls an Edge Function that
  sends the reminders that are due, and records them so none are sent twice. Count reminders separately from
  the 60-per-hour nudge cap.
- **Permission:** none. A map or location picker for the meeting place would need `expo-location` (new APK,
  foreground location only).

### Ride check-in ("I'm here") + "Nudge everyone not here"
- **What:** at the meeting time, riders tap "I'm here". The organiser sees who hasn't arrived and can nudge
  or alarm all of them at once.
- **Native change:** **none for a manual check-in button (over the air).** "Nudge everyone not here" is a
  server function that sends one nudge per missing rider, within the normal limits.
- **Automatic check-in** (detect arrival at the meeting spot) needs `expo-location` and `expo-task-manager`
  with geofencing (new APK).
- **Permission:** for automatic check-in, background location (`ACCESS_BACKGROUND_LOCATION`), a foreground
  service, and Google Play's background-location declaration. Manual check-in needs none.
