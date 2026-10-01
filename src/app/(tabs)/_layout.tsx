import { Link, Tabs } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { FuelDrawer } from '../../components/FuelDrawer';
import { groupByWeek } from '../../lib/fuel';
import { useThemeName } from '../../lib/store';
import { colors } from '../../lib/theme';
import { useFuel } from '../../lib/useFuel';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>;
}

function SettingsButton() {
  return (
    <Link href="/settings" asChild>
      <Pressable hitSlop={12} accessibilityLabel="Settings" style={{ marginRight: 16 }}>
        <Text style={{ color: '#fff', fontSize: 22 }}>⚙︎</Text>
      </Pressable>
    </Link>
  );
}

/** Header button that opens the fuel side panel; a dot appears when a price change is coming up. */
function FuelButton({ onPress }: { onPress: () => void }) {
  const { data } = useFuel();
  const latest = data ? groupByWeek(data.adjustments)[0] : undefined;
  const upcoming = latest && latest.date > data!.fetchedAt.slice(0, 10);
  const dot = upcoming ? (latest.items.some((a) => a.direction === 'up') ? colors.danger : colors.ok) : null;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Fuel prices"
      style={{ marginLeft: 16 }}
    >
      <Text style={{ fontSize: 22 }}>⛽</Text>
      {dot && (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -4,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: dot,
            borderWidth: 1.5,
            borderColor: colors.header,
          }}
        />
      )}
    </Pressable>
  );
}

export default function TabsLayout() {
  useThemeName(); // re-render tab bar/header colors on theme change
  const [fuelOpen, setFuelOpen] = useState(false);
  return (
    <>
      <Tabs
        screenOptions={{
          headerLeft: () => <FuelButton onPress={() => setFuelOpen(true)} />,
          headerStyle: { backgroundColor: colors.header },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          headerRight: () => <SettingsButton />,
          sceneStyle: { backgroundColor: colors.bg },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
          },
          tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'My Garage',
            tabBarLabel: 'Maintenance',
            tabBarIcon: ({ focused }) => <TabIcon emoji="🔧" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="gallery"
          options={{
            title: 'Gallery',
            tabBarIcon: ({ focused }) => <TabIcon emoji="🖼️" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
          }}
        />
      </Tabs>
      <FuelDrawer visible={fuelOpen} onClose={() => setFuelOpen(false)} />
    </>
  );
}
