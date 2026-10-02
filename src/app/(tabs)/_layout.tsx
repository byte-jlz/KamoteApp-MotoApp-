import { Link, Tabs } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import { FuelDrawer } from '../../components/FuelDrawer';
import { useAuth } from '../../lib/auth';
import { useFriends } from '../../lib/friends';
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

/** "📰 F U E L" tab on the left edge: tap or swipe right to open the fuel side panel. A dot shows an upcoming change. */
function FuelSideTab({ onOpen }: { onOpen: () => void }) {
  const { data } = useFuel();
  const latest = data ? groupByWeek(data.adjustments)[0] : undefined;
  const upcoming = latest && latest.date > data!.fetchedAt.slice(0, 10);
  const dot = upcoming ? (latest.items.some((a) => a.direction === 'up') ? colors.danger : colors.ok) : null;
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dx > 8 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderRelease: (_, g) => g.dx > 20 && onOpen(),
      }),
    [onOpen],
  );
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: '38%' }} {...swipe.panHandlers}>
      <Pressable
        onPress={onOpen}
        hitSlop={{ top: 8, bottom: 8, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={`Fuel prices and headlines${dot ? ', price change coming' : ''}`}
        style={({ pressed }) => ({
          width: 26,
          paddingVertical: 10,
          alignItems: 'center',
          gap: 1,
          backgroundColor: colors.header,
          borderTopRightRadius: 12,
          borderBottomRightRadius: 12,
          opacity: pressed ? 0.75 : 0.92,
          elevation: 6,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 6,
          shadowOffset: { width: 2, height: 2 },
        })}
      >
        <Text style={{ fontSize: 14, marginBottom: 4 }}>📰</Text>
        {'FUEL'.split('').map((letter, i) => (
          <Text key={i} style={{ color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 14 }}>
            {letter}
          </Text>
        ))}
        {dot && (
          <View
            style={{
              position: 'absolute',
              top: 4,
              right: 3,
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: dot,
              borderWidth: 1.5,
              borderColor: colors.header,
            }}
          />
        )}
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  useThemeName(); // re-render tab bar/header colors on theme change
  const [fuelOpen, setFuelOpen] = useState(false);
  const openFuel = useCallback(() => setFuelOpen(true), []);
  const { mode } = useAuth();
  const { incoming } = useFriends();
  const badge = mode === 'account' && incoming > 0 ? (incoming > 99 ? '99+' : incoming) : undefined;
  return (
    <>
      <Tabs
        screenOptions={{
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
          name="friends"
          options={{
            title: 'Friends',
            tabBarIcon: ({ focused }) => <TabIcon emoji="👥" focused={focused} />,
            tabBarBadge: badge,
            tabBarBadgeStyle: { backgroundColor: colors.danger, color: '#fff', fontSize: 11 },
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
      {!fuelOpen && <FuelSideTab onOpen={openFuel} />}
      <FuelDrawer visible={fuelOpen} onClose={() => setFuelOpen(false)} />
    </>
  );
}
