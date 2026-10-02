import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, Chip, Field, Screen, styles } from '../../components/ui';
import { useFriends } from '../../lib/friends';
import { MAX_MESSAGE, nudgeApi, NudgeKind, QUICK_MESSAGES, sendErrorText, showBanner } from '../../lib/nudges';
import { colors } from '../../lib/theme';

/** Write an optional message and send a 👋 Nudge or a 🚨 Alarm to a friend. */
export default function NudgeScreen() {
  const params = useLocalSearchParams<{ id: string; kind?: string; name?: string }>();
  const kind: NudgeKind = params.kind === 'alarm' ? 'alarm' : 'nudge';
  const name = params.name || 'your friend';
  const { offline } = useFriends();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const alarm = kind === 'alarm';
  const length = Array.from(message).length;

  const send = async () => {
    setBusy(true);
    const r = await nudgeApi.send(params.id, kind, message);
    setBusy(false);
    if (!r.ok) return Alert.alert(alarm ? 'Alarm not sent' : 'Nudge not sent', sendErrorText(r));
    if (r.status === 'no_device') {
      return Alert.alert('Not delivered', `${name} can’t receive nudges yet; they need to open the updated app once.`);
    }
    router.back();
    showBanner({ kind: 'info', title: alarm ? `🚨 Alarm sent to ${name}` : `👋 Nudge sent to ${name}`, body: '' });
  };

  const confirmSend = () => {
    if (length > MAX_MESSAGE) return Alert.alert('Message too long', `Messages can be up to ${MAX_MESSAGE} characters.`);
    if (!alarm) return send();
    Alert.alert(`Send a loud alert to ${name}?`, 'Their phone rings at alarm volume. Use it when it matters, like when everyone is waiting.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send alarm', style: 'destructive', onPress: send },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: alarm ? '🚨 Alarm' : '👋 Nudge' }} />
      <Screen>
        <Card style={{ gap: 6, ...(alarm ? { backgroundColor: colors.dangerBg, borderColor: colors.dangerBg } : {}) }}>
          <Text style={styles.title}>{alarm ? `Call ${name} loudly` : `Nudge ${name}`}</Text>
          <Text style={styles.muted}>
            {alarm
              ? 'Rings at alarm volume with a long vibration, and shows on their lock screen. They can answer with one tap.'
              : 'A normal notification. They can answer with one tap.'}
          </Text>
        </Card>

        <Card>
          <Field
            label="Message (optional)"
            value={message}
            onChangeText={setMessage}
            placeholder={alarm ? 'Nasaan ka na? Kami na lang ang naghihintay.' : 'Ride na tayo!'}
            maxLength={MAX_MESSAGE}
            hint={`${length}/${MAX_MESSAGE}`}
          />
          <View style={[styles.row, { gap: 8, flexWrap: 'wrap' }]}>
            {QUICK_MESSAGES.map((q) => (
              <Chip key={q} label={q} selected={message === q} onPress={() => setMessage(message === q ? '' : q)} />
            ))}
          </View>
        </Card>

        <Button
          title={busy ? 'Sending…' : alarm ? '🚨 Send alarm' : '👋 Send nudge'}
          variant={alarm ? 'danger' : 'primary'}
          onPress={confirmSend}
          disabled={busy || offline}
        />
        {offline ? <Text style={[styles.hint, { textAlign: 'center' }]}>You’re offline.</Text> : null}
      </Screen>
    </>
  );
}
