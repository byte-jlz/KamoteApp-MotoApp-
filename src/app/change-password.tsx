import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, Text } from 'react-native';
import { PasswordField } from '../components/PasswordField';
import { Button, Card, Checkbox, Screen, styles } from '../components/ui';
import { MIN_PASSWORD, useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

/**
 * Two uses:
 *  - forced: an admin created the account or reset the password. Nothing else in the app is reachable
 *    (see the route guards in _layout.tsx), and it can't be dismissed. The only other option is Log out.
 *  - normal: "Change password" from the Account screen.
 */
export default function ChangePassword() {
  const { account, changePassword, recordConsent, signOut } = useAuth();
  const forced = !!account?.mustChangePassword;
  const askConsent = forced && !!account?.needsConsent;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  // Android back button does nothing while the change is required (only while this screen is in front,
  // so it still works on the privacy notice opened from here).
  useFocusEffect(
    useCallback(() => {
      if (!forced) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }, [forced]),
  );

  // Once the server clears the flag, the rest of the app opens; go to the home screen.
  const wasForced = useRef(forced);
  useEffect(() => {
    if (wasForced.current && !forced) router.replace('/');
    wasForced.current = forced;
  }, [forced]);

  const submit = async () => {
    const problem = !current
      ? forced
        ? 'Enter the temporary password you were given.'
        : 'Enter your current password.'
      : next.length < MIN_PASSWORD
        ? `Your new password needs at least ${MIN_PASSWORD} characters.`
        : next !== confirm
          ? 'The two new passwords don’t match.'
          : next === current
            ? 'Your new password must be different from the current one.'
            : askConsent && !consent
              ? 'Please read and agree to the privacy notice.'
              : null;
    if (problem) return Alert.alert('Check your details', problem);

    setBusy(true);
    // Record consent first: once the password is changed this screen closes.
    if (askConsent) {
      const c = await recordConsent();
      if (!c.ok) {
        setBusy(false);
        return Alert.alert('Could not save', c.message);
      }
    }
    const r = await changePassword(current, next);
    setBusy(false);
    if (!r.ok) return Alert.alert('Could not change password', r.message);
    if (!forced) {
      Alert.alert('Password changed', 'Use your new password next time you log in.');
      router.back();
    }
  };

  const logOut = () =>
    Alert.alert('Log out?', 'You can log in again later, or continue as a guest.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => signOut() },
    ]);

  return (
    <>
      <Stack.Screen
        options={
          forced
            ? { title: 'Set your new password', headerBackVisible: false, gestureEnabled: false, headerLeft: () => null }
            : { title: 'Change password' }
        }
      />
      <Screen>
        {forced && (
          <Card style={{ gap: 6 }}>
            <Text style={styles.title}>🔒 Choose your own password</Text>
            <Text style={styles.muted}>
              You signed in with a temporary password. Before using MotoMonitor, enter it below and choose a new password
              only you know.
            </Text>
          </Card>
        )}
        <Card>
          <PasswordField
            label={forced ? 'Temporary password' : 'Current password'}
            value={current}
            onChangeText={setCurrent}
            autoComplete="current-password"
            textContentType="password"
          />
          <PasswordField
            label="New password"
            value={next}
            onChangeText={setNext}
            autoComplete="new-password"
            textContentType="newPassword"
            hint={`At least ${MIN_PASSWORD} characters, different from the ${forced ? 'temporary' : 'current'} one.`}
          />
          <PasswordField
            label="Confirm new password"
            value={confirm}
            onChangeText={setConfirm}
            autoComplete="new-password"
            textContentType="newPassword"
          />
        </Card>

        {askConsent && (
          <Card>
            <Checkbox
              label="I agree to the privacy notice"
              sub="MotoMonitor stores your account and your bikes’ records online so you can back them up and sign in on other phones."
              checked={consent}
              onPress={() => setConsent((c) => !c)}
            />
            <Pressable onPress={() => router.push('/privacy')} hitSlop={8} style={{ alignSelf: 'flex-start', marginLeft: 36 }}>
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Read the privacy notice</Text>
            </Pressable>
          </Card>
        )}

        <Button title={busy ? 'Saving…' : 'Save new password'} onPress={submit} disabled={busy} />
        {forced && <Button title="Log out" variant="ghost" onPress={logOut} />}
      </Screen>
    </>
  );
}
