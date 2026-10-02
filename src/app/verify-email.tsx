import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { Button, Card, Field, Screen, styles } from '../components/ui';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

const RESEND_SECONDS = 60;

export default function VerifyEmail() {
  const { email = '' } = useLocalSearchParams<{ email?: string }>();
  const { verifySignupCode, resendSignupCode } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async () => {
    if (!/^\d{6,10}$/.test(code.trim())) return Alert.alert('Check the code', 'Enter the code from the email.');
    setBusy(true);
    const r = await verifySignupCode(email, code);
    setBusy(false);
    if (!r.ok) Alert.alert('Could not confirm', r.message);
  };

  const resend = async () => {
    setWait(RESEND_SECONDS);
    const r = await resendSignupCode(email);
    Alert.alert(r.ok ? 'Code sent' : 'Could not send', r.ok ? `We sent a new code to ${email}.` : r.message);
  };

  return (
    <Screen>
      <Card style={{ gap: 6 }}>
        <Text style={styles.title}>📧 Check your email</Text>
        <Text style={styles.muted}>
          We sent a code to <Text style={{ fontWeight: '700', color: colors.text }}>{email}</Text>. Enter it below to
          finish creating your account.
        </Text>
        <Text style={styles.hint}>Can’t find it? Check your Spam or Promotions folder.</Text>
      </Card>
      <Card>
        <Field
          label="Code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={10}
          returnKeyType="go"
          onSubmitEditing={submit}
          style={{ fontSize: 24, letterSpacing: 6, textAlign: 'center' }}
        />
        <Button title={busy ? 'Confirming…' : 'Confirm'} onPress={submit} disabled={busy} />
        <Pressable onPress={resend} disabled={wait > 0} hitSlop={8} style={{ alignSelf: 'center', marginTop: 14 }}>
          <Text style={{ color: wait > 0 ? colors.muted : colors.primary, fontWeight: '600' }}>
            {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          </Text>
        </Pressable>
      </Card>
      <Text style={[styles.hint, { textAlign: 'center' }]}>
        Already confirmed, or got no email because you already have an account?
      </Text>
      <Pressable onPress={() => router.replace('/login')} hitSlop={8} style={{ alignSelf: 'center', padding: 4 }}>
        <Text style={{ color: colors.primary, fontWeight: '600' }}>Log in</Text>
      </Pressable>
    </Screen>
  );
}
