import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { PasswordField } from '../components/PasswordField';
import { Button, Card, Checkbox, Field, Screen, styles } from '../components/ui';
import { isValidUsername, MIN_PASSWORD, normalizeUsername, useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

/** Checks the username while the rider types (after a short pause). */
function useUsernameAvailability(value: string): Availability {
  const [result, setResult] = useState<{ name: string; free: boolean } | null>(null);
  const name = normalizeUsername(value);
  const valid = isValidUsername(name);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('username_available', { p_username: name });
      if (!cancelled && !error) setResult({ name, free: !!data });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [name, valid]);

  if (!name) return 'idle';
  if (!valid) return 'invalid';
  if (result?.name !== name) return 'checking';
  return result.free ? 'free' : 'taken';
}

const AVAILABILITY_HINT: Record<Availability, string> = {
  idle: '3–20 characters: letters, numbers, dot or underscore. You can log in with it instead of your email.',
  checking: 'Checking…',
  free: '✓ Available',
  taken: '✗ Already taken',
  invalid: '3–20 characters: letters, numbers, dot or underscore.',
};

export default function Signup() {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const availability = useUsernameAvailability(username);

  const submit = async () => {
    const problem = !fullName.trim()
      ? 'Enter your name.'
      : !isValidUsername(username)
        ? 'Usernames are 3–20 characters: letters, numbers, dot or underscore.'
        : availability === 'taken'
          ? 'That username is already taken.'
          : !/^\S+@\S+\.\S+$/.test(email.trim())
            ? 'Enter a valid email address.'
            : password.length < MIN_PASSWORD
              ? `Your password needs at least ${MIN_PASSWORD} characters.`
              : password !== confirm
                ? 'The two passwords don’t match.'
                : !consent
                  ? 'Please read and agree to the privacy notice.'
                  : null;
    if (problem) return Alert.alert('Check your details', problem);

    setBusy(true);
    const r = await signUp({ email, password, username, fullName });
    setBusy(false);
    if (!r.ok) return Alert.alert('Could not create account', r.message);
    if (r.needsCode) router.replace({ pathname: '/verify-email', params: { email: email.trim() } });
  };

  const hintColor = availability === 'free' ? colors.ok : availability === 'taken' ? colors.danger : undefined;

  return (
    <Screen>
      <Card>
        <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" textContentType="name" />
        <Field
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          maxLength={20}
        />
        <Text style={[styles.hint, { marginTop: -10, marginBottom: 14 }, hintColor && { color: hintColor }]}>
          {AVAILABILITY_HINT[availability]}
        </Text>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          keyboardType="email-address"
          hint="We’ll email you a code to confirm it’s yours."
        />
        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          autoComplete="new-password"
          textContentType="newPassword"
          hint={`At least ${MIN_PASSWORD} characters.`}
        />
        <PasswordField
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          autoComplete="new-password"
          textContentType="newPassword"
        />
      </Card>

      <Card>
        <Checkbox
          label="I agree to the privacy notice"
          sub="MotoMonitor will store your account and your bikes’ records online so you can back them up and sign in on other phones."
          checked={consent}
          onPress={() => setConsent((c) => !c)}
        />
        <Pressable onPress={() => router.push('/privacy')} hitSlop={8} style={{ alignSelf: 'flex-start', marginLeft: 36 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Read the privacy notice</Text>
        </Pressable>
      </Card>

      <Button title={busy ? 'Creating account…' : 'Create account'} onPress={submit} disabled={busy || !consent} />
      <Pressable onPress={() => router.replace('/login')} hitSlop={8} style={{ alignSelf: 'center', padding: 8 }}>
        <Text style={styles.muted}>
          Already have an account? <Text style={{ color: colors.primary, fontWeight: '600' }}>Log in</Text>
        </Text>
      </Pressable>
    </Screen>
  );
}
