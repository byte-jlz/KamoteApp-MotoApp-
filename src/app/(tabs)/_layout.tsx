import { Link, Tabs } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { useThemeName } from '../../lib/store';
import { colors } from '../../lib/theme';

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

export default function TabsLayout() {
  useThemeName(); // re-render tab bar/header colors on theme change
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.header },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        headerRight: () => <SettingsButton />,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
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
  );
}
