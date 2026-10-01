import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { UpdatePrompt } from '../components/UpdatePrompt';
import { configureNotifications, ensurePermission } from '../lib/notifications';
import { StoreProvider, useStore } from '../lib/store';
import { colors } from '../lib/theme';

configureNotifications();

function RootStack() {
  const { ready, settings } = useStore();

  useEffect(() => {
    if (ready && settings.remindersEnabled) ensurePermission();
  }, [ready, settings.remindersEnabled]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.header }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.header },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'MotoPMS' }} />
        <Stack.Screen name="bike-form" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="bike/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="bike/[id]/log" options={{ title: 'Log Service', presentation: 'modal' }} />
        <Stack.Screen name="bike/[id]/history" options={{ title: 'Service History' }} />
        <Stack.Screen name="bike/[id]/item/[itemId]" options={{ title: '' }} />
      </Stack>
      <UpdatePrompt />
    </>
  );
}

export default function RootLayout() {
  return (
    <StoreProvider>
      <StatusBar style="light" />
      <RootStack />
    </StoreProvider>
  );
}
