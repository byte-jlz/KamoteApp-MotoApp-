import { useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import { PasswordField } from '../components/PasswordField';
import { Button, Card, Checkbox, Screen, styles } from '../components/ui';
import { useAuth } from '../lib/auth';
import { accountMediaCount } from '../lib/sync';
import { colors } from '../lib/theme';

/** Settings → Account → Delete account. Permanently deletes the account and everything stored online. */
export default function DeleteAccount() {
  const { account, deleteAccount } = useAuth();
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(false);
  const [media, setMedia] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (account) accountMediaCount(account.userId).then(setMedia);
  }, [account]);

  if (!account) return null;

  const run = async () => {
    setBusy(true);
    const r = await deleteAccount(password, keep ? 'keep' : 'remove');
    // On success the app leaves the account (this screen closes); only failures come back here.
    if (!r.ok) {
      setBusy(false);
      Alert.alert('Could not delete account', r.message);
    }
  };

  const confirm = () => {
    if (!password) return Alert.alert('Enter your password', 'Enter your password to confirm it’s you.');
    Alert.alert(
      'Delete your account?',
      [
        'Your account and everything stored online will be deleted for good. This can’t be undone.',
        keep
          ? 'Your records will stay on this phone so you can keep using MotoMonitor as a guest.'
          : media
            ? `⚠️ Your records and ${media} photo${media === 1 ? '' : 's'}/video${media === 1 ? '' : 's'} will also be deleted from this phone.`
            : 'Your records will also be deleted from this phone.',
      ].join('\n\n'),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: run },
      ],
    );
  };

  return (
    <Screen>
      <Card style={{ gap: 8, backgroundColor: colors.dangerBg, borderColor: colors.dangerBg }}>
        <Text style={[styles.title, { color: colors.danger }]}>This can’t be undone</Text>
        <Text style={styles.body}>Deleting your account permanently removes from our servers:</Text>
        <Text style={styles.body}>
          • Your login, username and profile{'\n'}• Your bikes, maintenance items, odometer readings and service history
          {'\n'}• Your clubs and settings{'\n'}• Your friends, friend requests and blocked riders
        </Text>
        <Text style={styles.muted}>Your friends will no longer see you. If you log in on other phones, they will be logged out.</Text>
      </Card>

      <Card>
        <Checkbox
          label="Keep my records on this phone"
          sub={`Keep using MotoMonitor as a guest, offline, with your bikes and history${media ? ' and photos' : ''}. Otherwise they are deleted from this phone too.`}
          checked={keep}
          onPress={() => setKeep((k) => !k)}
        />
      </Card>

      <Card>
        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          autoComplete="current-password"
          textContentType="password"
          hint="To make sure it’s you."
        />
      </Card>

      <Button title={busy ? 'Deleting…' : 'Delete my account'} variant="danger" onPress={confirm} disabled={busy} />
    </Screen>
  );
}
