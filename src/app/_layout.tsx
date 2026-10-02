import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { UpdatePrompt } from '../components/UpdatePrompt';
import { AuthProvider, useAuth } from '../lib/auth';
import { configureNotifications, ensurePermission, onFuelAlertTap, syncFuelAlerts } from '../lib/notifications';
import { StoreProvider, useStore } from '../lib/store';
import { colors } from '../lib/theme';

configureNotifications();

function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.header }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

function RootStack() {
  const { ready, settings, themeName, profile, updateProfile } = useStore();
  const { mode, account } = useAuth();
  const loggedIn = mode === 'account';
  const mustChange = loggedIn && !!account?.mustChangePassword;
  // Guests and logged-in riders use the app normally; a flagged account sees only the password screen.
  const inApp = mode === 'guest' || (loggedIn && !mustChange);

  // A new account's name (typed at sign-up) fills in the profile on this phone if it's still empty.
  const serverName = account?.fullName?.trim();
  useEffect(() => {
    if (ready && serverName && !profile.fullName.trim()) updateProfile(serverName);
  }, [ready, serverName, profile.fullName, updateProfile]);

  useEffect(() => {
    if (ready && settings.remindersEnabled) ensurePermission();
  }, [ready, settings.remindersEnabled]);

  // Keep this phone registered for fuel price pushes (and its on/off choice) in Supabase.
  useEffect(() => {
    if (ready) syncFuelAlerts(settings.fuelAlerts);
  }, [ready, settings.fuelAlerts]);

  useEffect(() => {
    if (ready) return onFuelAlertTap(() => router.push('/fuel'));
  }, [ready]);

  if (!ready) return <Loading />;

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
        {/* Order matters: when a group is closed, the router falls back to the first screen still open. */}
        <Stack.Protected guard={inApp}>
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
          <Stack.Screen name="fuel" options={{ title: 'Fuel Prices' }} />
          <Stack.Screen name="bike/[id]/photo/[photoId]" options={{ title: '' }} />
        </Stack.Protected>
        <Stack.Protected guard={mode === 'welcome'}>
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={mode === 'welcome' || mode === 'guest'}>
          <Stack.Screen name="login" options={{ title: 'Log in' }} />
          <Stack.Screen name="signup" options={{ title: 'Create account' }} />
          <Stack.Screen name="verify-email" options={{ title: 'Confirm your email' }} />
          <Stack.Screen name="forgot-password" options={{ title: 'Forgot password' }} />
        </Stack.Protected>
        <Stack.Protected guard={loggedIn}>
          <Stack.Screen name="change-password" options={{ title: 'Change password' }} />
        </Stack.Protected>
        <Stack.Protected guard={inApp && loggedIn}>
          <Stack.Screen name="account" options={{ title: 'Account' }} />
        </Stack.Protected>
        <Stack.Screen name="privacy" options={{ title: 'Privacy notice' }} />
      </Stack>
      <UpdatePrompt />
      {/* Android button bar: match the app instead of the system's light contrast backing. */}
      <NavigationBar style={themeName} />
    </ThemeProvider>
  );
}

/** Guest data and each account's data are stored separately; switching remounts the store and the screens. */
function Root() {
  const { mode, storageKey } = useAuth();
  if (mode === 'loading') return <Loading />;
  return (
    <StoreProvider key={storageKey} storageKey={storageKey}>
      <RootStack />
    </StoreProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Root />
    </AuthProvider>
  );
}
