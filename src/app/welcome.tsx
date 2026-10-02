import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, styles } from '../components/ui';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

export default function Welcome() {
  const { continueAsGuest, notice } = useAuth();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
      <View style={{ backgroundColor: colors.header, paddingTop: insets.top + 48, paddingBottom: 40, paddingHorizontal: 24, alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 56 }}>🏍️</Text>
        <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>MotoMonitor</Text>
        <Text style={{ color: '#D1D5DB', fontSize: 15, textAlign: 'center' }}>
          Keep track of your motorcycle’s maintenance, service history and fuel prices.
        </Text>
      </View>

      <View style={styles.screenContent}>
        {notice ? (
          <Card style={{ backgroundColor: colors.warnBg, borderColor: colors.warnBg }}>
            <Text style={[styles.body, { color: colors.warn }]}>ℹ️ {notice}</Text>
          </Card>
        ) : null}

        <Card style={{ gap: 10 }}>
          <Button title="Log in" onPress={() => router.push('/login')} />
          <Button title="Create account" variant="secondary" onPress={() => router.push('/signup')} />
          <Text style={[styles.hint, { textAlign: 'center' }]}>
            An account backs up your bikes and records, so you can use them on another phone.
          </Text>
        </Card>

        <Card style={{ gap: 6 }}>
          <Button title="Continue as guest" variant="ghost" onPress={continueAsGuest} />
          <Text style={[styles.hint, { textAlign: 'center', marginTop: 0 }]}>
            As a guest, everything stays on this phone and works offline. You can create an account later in Settings.
          </Text>
        </Card>

        <Pressable onPress={() => router.push('/privacy')} hitSlop={8} style={{ alignSelf: 'center', padding: 8 }}>
          <Text style={{ color: colors.primary, fontWeight: '600' }}>Privacy notice</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
