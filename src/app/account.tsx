import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { LogOutButton } from '../components/LogOutButton';
import { Button, Card, Field, Screen, styles } from '../components/ui';
import { normalizeUsername, useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

export default function AccountScreen() {
  const { account, updateUsername } = useAuth();
  const [username, setUsername] = useState(account?.username ?? '');
  const [busy, setBusy] = useState(false);
  if (!account) return null;

  const changed = normalizeUsername(username) !== (account.username ?? '');

  const saveUsername = async () => {
    setBusy(true);
    const r = await updateUsername(username);
    setBusy(false);
    if (!r.ok) return Alert.alert('Could not save username', r.message);
    setUsername(normalizeUsername(username));
    Alert.alert('Saved', 'You can now log in with this username.');
  };

  return (
    <Screen>
      <Card style={{ gap: 4 }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={styles.title}>Logged in</Text>
          {account.role === 'admin' && (
            <View style={[styles.pill, { backgroundColor: colors.primaryBg }]}>
              <Text style={[styles.pillText, { color: colors.primary }]}>Admin</Text>
            </View>
          )}
        </View>
        <Text style={styles.body}>{account.email}</Text>
      </Card>

      <Card>
        <Field
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          placeholder="Choose a username"
          hint="Log in with this or your email. 3–20 characters: letters, numbers, dot or underscore."
        />
        <Button title={busy ? 'Saving…' : 'Save username'} variant="secondary" onPress={saveUsername} disabled={busy || !changed} />
      </Card>

      <Button title="Change password" variant="secondary" onPress={() => router.push('/change-password')} />
      <LogOutButton />
    </Screen>
  );
}
