import { useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { PasswordField } from '../components/PasswordField';
import { Button, Card, Field, Screen, styles } from '../components/ui';
import { MIN_PASSWORD, useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

export default function ForgotPassword() {
  const { sendResetCode, resetPasswordWithCode } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return Alert.alert('Check your email', 'Enter the email address of your account.');
    setBusy(true);
    const r = await sendResetCode(email);
    setBusy(false);
    if (!r.ok) return Alert.alert('Could not send code', r.message);
    setStep('code');
  };

  const reset = async () => {
    const problem = !/^\d{6,10}$/.test(code.trim())
      ? 'Enter the code from the email.'
      : password.length < MIN_PASSWORD
        ? `Your new password needs at least ${MIN_PASSWORD} characters.`
        : password !== confirm
          ? 'The two passwords don’t match.'
          : null;
    if (problem) return Alert.alert('Check your details', problem);
    setBusy(true);
    const r = await resetPasswordWithCode(email, code, password);
    setBusy(false);
    if (!r.ok) Alert.alert('Could not reset password', r.message);
    // On success the app logs in and switches to the account automatically.
  };

  if (step === 'email') {
    return (
      <Screen>
        <Card>
          <Text style={[styles.muted, { marginBottom: 14 }]}>
            Enter the email address of your account. We’ll send you a code to set a new password.
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
            returnKeyType="send"
            onSubmitEditing={sendCode}
          />
          <Button title={busy ? 'Sending…' : 'Send code'} onPress={sendCode} disabled={busy} />
        </Card>
        <Text style={[styles.hint, { textAlign: 'center' }]}>
          Only have a username? Ask the app admin to reset your password.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card style={{ gap: 6 }}>
        <Text style={styles.muted}>
          If <Text style={{ fontWeight: '700', color: colors.text }}>{email.trim()}</Text> has an account, we sent it a
          code. Check your Spam folder too.
        </Text>
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
          style={{ fontSize: 24, letterSpacing: 6, textAlign: 'center' }}
        />
        <PasswordField
          label="New password"
          value={password}
          onChangeText={setPassword}
          autoComplete="new-password"
          textContentType="newPassword"
          hint={`At least ${MIN_PASSWORD} characters.`}
        />
        <PasswordField
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <Button title={busy ? 'Saving…' : 'Set new password'} onPress={reset} disabled={busy} />
        <Pressable onPress={() => setStep('email')} hitSlop={8} style={{ alignSelf: 'center', marginTop: 14 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Use a different email</Text>
        </Pressable>
      </Card>
    </Screen>
  );
}
