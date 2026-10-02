import { router } from 'expo-router';
import { Alert, Linking, Switch, Text, View } from 'react-native';
import { NudgeSettingsCard } from '../components/Nudges';
import { Button, Card, Chip, Screen, styles } from '../components/ui';
import {
  ensurePermission,
  notificationsSupported,
  notificationsUnavailableReason,
  sendTestNotification,
} from '../lib/notifications';
import { useAuth } from '../lib/auth';
import { applyOtaUpdate, checkForUpdates, updateDetails } from '../lib/updates';
import { fmtDate } from '../lib/format';
import { useState } from 'react';
import { useStore } from '../lib/store';
import { colors } from '../lib/theme';

function Row({ title, sub, value, onChange }: { title: string; sub: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 10, gap: 12 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.body}>{title}</Text>
        <Text style={styles.hint}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

function AccountCard() {
  const { account } = useAuth();
  if (account) {
    return (
      <Card style={{ gap: 6 }}>
        <Text style={styles.title}>Account</Text>
        <Text style={styles.body}>{account.username ? `@${account.username}` : account.email}</Text>
        {account.username ? <Text style={styles.muted}>{account.email}</Text> : null}
        <Button title="Manage account" variant="secondary" onPress={() => router.push('/account')} style={{ marginTop: 6 }} />
      </Card>
    );
  }
  return (
    <Card style={{ gap: 10 }}>
      <Text style={styles.title}>Account</Text>
      <Text style={styles.muted}>
        You’re using MotoMonitor as a guest, so your records are only on this phone. Create a free account to back them
        up and use them on another phone.
      </Text>
      <View style={[styles.row, { gap: 10 }]}>
        <Button title="Log in" variant="secondary" onPress={() => router.push('/login')} style={{ flex: 1 }} />
        <Button title="Create account" onPress={() => router.push('/signup')} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

export default function SettingsScreen() {
  const { settings, updateSettings } = useStore();
  const { account } = useAuth();

  const toggleReminders = async (v: boolean) => {
    if (v && notificationsSupported && !(await ensurePermission())) {
      Alert.alert('Notifications blocked', 'Allow notifications for this app in your phone settings to get PMS reminders.');
    }
    updateSettings({ remindersEnabled: v });
  };

  const [checking, setChecking] = useState(false);
  const info = updateDetails();

  const checkUpdates = async () => {
    setChecking(true);
    const r = await checkForUpdates();
    setChecking(false);
    if (r.kind === 'ota') {
      Alert.alert('Update ready', 'A new version was downloaded. Restart to use it.', [
        { text: 'Later', style: 'cancel' },
        { text: 'Restart', onPress: () => applyOtaUpdate() },
      ]);
    } else if (r.kind === 'apk') {
      Alert.alert('New version available', `Version ${r.latestVersion} is available.${r.releaseNotes ? `

${r.releaseNotes}` : ''}`, [
        { text: 'Later', style: 'cancel' },
        { text: 'Download', onPress: () => Linking.openURL(r.downloadUrl) },
      ]);
    } else {
      Alert.alert('You are up to date', `MotoMonitor ${info.version} is the latest version.`);
    }
  };

  const test = async () => {
    const ok = await sendTestNotification();
    if (!ok) Alert.alert('Notifications unavailable', 'Allow notifications for this app in your phone settings.');
  };

  return (
    <Screen>
      <AccountCard />
      {!notificationsSupported && (
        <Card style={{ backgroundColor: colors.warnBg, borderColor: colors.warnBg }}>
          <Text style={[styles.body, { color: colors.warn }]}>ℹ️ {notificationsUnavailableReason}</Text>
        </Card>
      )}
      <Card style={{ gap: 10 }}>
        <Text style={styles.body}>Appearance</Text>
        <View style={[styles.row, { gap: 8 }]}>
          {(
            [
              ['light', '☀️ Light'],
              ['dark', '🌙 Dark'],
              ['system', '📱 System'],
            ] as const
          ).map(([value, label]) => (
            <Chip key={value} label={label} selected={settings.theme === value} onPress={() => updateSettings({ theme: value })} />
          ))}
        </View>
        <Text style={styles.hint}>System follows your phone’s dark mode setting.</Text>
      </Card>
      <Card>
        <Row
          title="Maintenance reminders"
          sub="Get notified a week before and on the day a service is due (9:00 AM)."
          value={settings.remindersEnabled}
          onChange={toggleReminders}
        />
        <Row
          title="Weekly odometer reminder"
          sub="Every Sunday at 6:00 PM, a nudge to log your mileage."
          value={settings.odometerReminder}
          onChange={(v) => updateSettings({ odometerReminder: v })}
        />
        <Row
          title="Fuel price alerts"
          sub="Get notified when a gasoline, diesel or kerosene price hike or rollback is announced."
          value={settings.fuelAlerts}
          onChange={(v) => updateSettings({ fuelAlerts: v })}
        />
      </Card>
      {notificationsSupported && <Button title="Send test notification" variant="secondary" onPress={test} />}
      {account ? <NudgeSettingsCard key={account.userId} userId={account.userId} /> : null}
      <Card style={{ gap: 6 }}>
        <Text style={styles.title}>About</Text>
        <Text style={styles.muted}>
          Version {info.version}
          {info.build ? ` (build ${info.build})` : ''}
          {info.updatedAt ? ` · updated ${fmtDate(info.updatedAt)}` : ''}
        </Text>
        <Button title={checking ? 'Checking…' : 'Check for updates'} variant='secondary' onPress={checkUpdates} disabled={checking} style={{ marginTop: 6 }} />
        <Button title="Privacy notice" variant="ghost" onPress={() => router.push('/privacy')} />
      </Card>
      <Card style={{ gap: 6 }}>
        <Text style={styles.title}>How reminders work</Text>
        <Text style={styles.muted}>
          Each item is due by distance or by time — whichever comes first. Time-based reminders are exact. For
          distance, MotoMonitor estimates the date from your average daily riding, so update your odometer regularly for the
          best accuracy.
        </Text>
        <Text style={styles.muted}>
          Default intervals are typical recommendations. Always follow your motorcycle’s owner’s manual.
        </Text>
      </Card>
    </Screen>
  );
}
