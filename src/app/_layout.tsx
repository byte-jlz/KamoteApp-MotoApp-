import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { UpdatePrompt } from '../components/UpdatePrompt';
import { configureNotifications, ensurePermission } from '../lib/notifications';
import { StoreProvider, useStore } from '../lib/store';
import { colors } from '../lib/theme';

configureNotifications();

function RootStack() {
  const { ready, settings, themeName } = useStore();

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

  // Keeps navigation backgrounds (transitions, modals) in step with our palette.
  const base = themeName === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.bg,
      card: colors.card,
      text: colors.text,
      border: colors.border,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.header },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Back' }} />
        <Stack.Screen name="bike-form" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="bike/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="bike/[id]/log" options={{ title: 'Log Service', presentation: 'modal' }} />
        <Stack.Screen name="bike/[id]/history" options={{ title: 'Service History' }} />
        <Stack.Screen name="bike/[id]/item/[itemId]" options={{ title: '' }} />
        <Stack.Screen name="bike/[id]/photos" options={{ title: 'Gallery' }} />
        <Stack.Screen name="album-form" options={{ presentation: 'modal' }} />
        <Stack.Screen name="profile-form" options={{ title: 'Edit Profile', presentation: 'modal' }} />
        <Stack.Screen name="club-form" options={{ presentation: 'modal' }} />
        <Stack.Screen name="bike/[id]/photo/[photoId]" options={{ title: '' }} />
      </Stack>
      <UpdatePrompt />
      {/* Android button bar: match the app instead of the system's light contrast backing. */}
      <NavigationBar style={themeName} />
    </ThemeProvider>
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
