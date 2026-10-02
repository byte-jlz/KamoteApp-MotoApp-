import { Alert, Linking, Text, View } from 'react-native';
import { Button, Card, Screen, styles } from '../components/ui';
import { ALARM_CHANNEL, ensurePermission, presentNow } from '../lib/notifications';
import { setupNudges } from '../lib/nudges';
import { colors } from '../lib/theme';

function Step({ n, title, children }: { n: number; title: string; children: string }) {
  return (
    <View style={[styles.row, { gap: 12, alignItems: 'flex-start' }]}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primaryBg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.primary, fontWeight: '800' }}>{n}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.body, { fontWeight: '700' }]}>{title}</Text>
        <Text style={[styles.muted, { lineHeight: 20 }]}>{children}</Text>
      </View>
    </View>
  );
}

function Brand({ name, children }: { name: string; children: string }) {
  return (
    <Text style={[styles.muted, { lineHeight: 20 }]}>
      <Text style={{ fontWeight: '700', color: colors.text }}>{name}: </Text>
      {children}
    </Text>
  );
}

/** Settings → Nudges → "Make sure you get alarms": stop the phone from blocking nudges. */
export default function NudgeHelp() {
  const openSettings = () => Linking.openSettings().catch(() => Alert.alert('Couldn’t open settings', 'Open Settings → Apps → MotoMonitor.'));

  const testAlarm = async () => {
    if (!(await ensurePermission())) {
      return Alert.alert('Notifications blocked', 'Turn on notifications for MotoMonitor first (step 1).');
    }
    await setupNudges();
    await presentNow({
      title: '🚨 Test alarm',
      body: 'This is how a ride alarm sounds. Check your alarm volume.',
      data: { screen: 'test', local: true },
      channelId: ALARM_CHANNEL,
    });
  };

  return (
    <Screen>
      <Card style={{ gap: 6 }}>
        <Text style={styles.title}>Why nudges can go missing</Text>
        <Text style={[styles.muted, { lineHeight: 20 }]}>
          Many phones (Xiaomi, Redmi, POCO, OPPO, realme, vivo, Infinix, TECNO) stop apps that you swipe away, to
          save battery. Then nudges and alarms don’t show until you open MotoMonitor again. These steps fix it.
        </Text>
      </Card>

      <Card style={{ gap: 14 }}>
        <Step n={1} title="Keep notifications on">
          In MotoMonitor’s settings, open Notifications and allow them. Make sure “Ride alarms” and “Nudges” are on.
        </Step>
        <Step n={2} title="Battery: No restrictions">
          In MotoMonitor’s settings, open Battery (or Battery saver) and choose “No restrictions” or “Unrestricted”.
        </Step>
        <Step n={3} title="Allow Autostart">
          Turn on Autostart (also called “Auto launch” or “Allow background activity”) for MotoMonitor. Where it is
          depends on your phone; see below.
        </Step>
        <Button title="Open MotoMonitor settings" onPress={openSettings} />
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={styles.title}>Where to find Autostart</Text>
        <Brand name="Xiaomi, Redmi, POCO">MotoMonitor’s settings → Autostart → on. Battery saver → No restrictions.</Brand>
        <Brand name="OPPO, realme">MotoMonitor’s settings → Battery → allow background activity and auto launch.</Brand>
        <Brand name="vivo">Settings → Battery → Background power consumption → MotoMonitor → allow. In i Manager → App manager → Autostart → on.</Brand>
        <Brand name="Infinix, TECNO">Phone Master → App auto-start → MotoMonitor → on. Battery → turn off power saving for MotoMonitor.</Brand>
        <Text style={styles.hint}>
          Tip: in the recent apps screen, you can also lock MotoMonitor (pull it down or tap the lock) so it isn’t
          cleared.
        </Text>
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={styles.title}>Check the sound</Text>
        <Text style={styles.muted}>Ride alarms play at your phone’s alarm volume, so turn that up. Do Not Disturb can still block them.</Text>
        <Button title="🔊 Test the alarm sound" variant="secondary" onPress={testAlarm} />
      </Card>
    </Screen>
  );
}
