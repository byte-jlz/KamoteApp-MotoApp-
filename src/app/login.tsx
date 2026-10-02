import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { PasswordField } from '../components/PasswordField';
import { Button, Card, Field, Screen, styles } from '../components/ui';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

export default function Login() {
  const { signIn, resendSignupCode } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!identifier.trim() || !password) return Alert.alert('Missing details', 'Enter your email or username, and your password.');
    setBusy(true);
    const r = await signIn(identifier, password);
    setBusy(false);
    if (r.ok) return; // the app switches to the account automatically
    if (r.code === 'email_not_confirmed') {
      const email = identifier.trim();
      await resendSignupCode(email);
      router.push({ pathname: '/verify-email', params: { email } });
      return;
    }
    Alert.alert('Could not log in', r.message);
  };

  return (
    <Screen>
      <Card>
        <Field
          label="Email or username"
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          keyboardType="email-address"
          returnKeyType="next"
        />
        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <Button title={busy ? 'Logging in…' : 'Log in'} onPress={submit} disabled={busy} />
        <Pressable onPress={() => router.push('/forgot-password')} hitSlop={8} style={{ alignSelf: 'center', marginTop: 14 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Forgot password?</Text>
        </Pressable>
      </Card>
      <Pressable onPress={() => router.replace('/signup')} hitSlop={8} style={{ alignSelf: 'center', padding: 8 }}>
        <Text style={styles.muted}>
          No account yet? <Text style={{ color: colors.primary, fontWeight: '600' }}>Create one</Text>
        </Text>
      </Pressable>
    </Screen>
  );
}
