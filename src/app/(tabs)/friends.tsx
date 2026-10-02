import { router, useFocusEffect } from 'expo-router';
import { ReactNode, useCallback, useState } from 'react';
import { AppState, Pressable, RefreshControl, Text, View } from 'react-native';
import { ActiveStatusToggle, LoginForFriendsCard, OfflineNotice, RiderRow } from '../../components/Friends';
import { ScanQrSheet } from '../../components/ScanQrSheet';
import { Button, Card, Screen, SectionTitle, styles } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { refreshFriends, statusText, useFriends } from '../../lib/friends';
import { colors, themedStyles } from '../../lib/theme';

const REFRESH_MS = 60_000;

function Divided({ index, children }: { index: number; children: ReactNode }) {
  return <View style={index > 0 && local.divider}>{children}</View>;
}

function FriendsList({ userId }: { userId: string }) {
  const { rows, loading, offline, loadedAt, incoming } = useFriends();
  const [scanOpen, setScanOpen] = useState(false);
  const [pulling, setPulling] = useState(false);

  // Fresh statuses while this screen is open: now, then every minute (only while the app is on screen).
  useFocusEffect(
    useCallback(() => {
      refreshFriends();
      const t = setInterval(() => AppState.currentState === 'active' && refreshFriends(), REFRESH_MS);
      return () => clearInterval(t);
    }, []),
  );

  const pull = async () => {
    setPulling(true);
    await refreshFriends();
    setPulling(false);
  };

  const friends = rows.filter((r) => r.relation === 'friend');
  // Online first, then recently active (most recent first), then offline; the server already sorted by name.
  const rank = (s: string | null, m: number | null) => (s === 'online' ? -1 : s === 'recent' ? (m ?? 0) : 1e9);
  const sorted = [...friends].sort((a, b) => rank(a.status, a.minutesAgo) - rank(b.status, b.minutesAgo));
  const outgoing = rows.filter((r) => r.relation === 'outgoing').length;
  const online = friends.filter((f) => f.status === 'online').length;

  return (
    <>
      <Screen refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} colors={[colors.primary]} tintColor={colors.primary} />}>
        <OfflineNotice />

        <View style={[styles.row, { gap: 8 }]}>
          <Button title="➕ Add" onPress={() => router.push('/friends/add')} style={local.action} disabled={offline} />
          <Button title="🔳 My QR" variant="secondary" onPress={() => router.push('/friends/qr')} style={local.action} />
          <Button title="📷 Scan QR" variant="secondary" onPress={() => setScanOpen(true)} style={local.action} disabled={offline} />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Friend requests, ${incoming} new`}
          onPress={() => router.push('/friends/requests')}
          style={({ pressed }) => pressed && { opacity: 0.8 }}
        >
          <Card style={[styles.row, { gap: 12 }]}>
            <Text style={{ fontSize: 24 }}>📨</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.body, { fontWeight: '600' }]}>Friend requests</Text>
              <Text style={[styles.muted, { fontSize: 13 }]}>
                {incoming ? `${incoming} waiting for you` : 'No new requests'}
                {outgoing ? ` · ${outgoing} sent` : ''}
              </Text>
            </View>
            {incoming > 0 && (
              <View style={local.badge}>
                <Text style={local.badgeText}>{incoming > 99 ? '99+' : incoming}</Text>
              </View>
            )}
            <Text style={local.chevron}>›</Text>
          </Card>
        </Pressable>

        <SectionTitle
          right={
            <View style={[styles.row, { gap: 8 }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Blocked riders"
                hitSlop={8}
                onPress={() => router.push('/friends/blocked')}
                style={({ pressed }) => [local.iconPill, pressed && { opacity: 0.6 }]}
              >
                <Text style={{ fontSize: 14 }}>⛔</Text>
              </Pressable>
              <ActiveStatusToggle key={userId} userId={userId} />
            </View>
          }
        >
          {`Friends${friends.length ? ` (${friends.length})` : ''}`}
          {online ? <Text style={{ color: colors.ok }}>{`  ● ${online} online`}</Text> : null}
        </SectionTitle>
        {sorted.length === 0 ? (
          <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
            <Text style={{ fontSize: 32 }}>👥</Text>
            <Text style={[styles.body, { fontWeight: '600' }]}>{loading && !loadedAt ? 'Loading…' : 'No friends yet'}</Text>
            <Text style={[styles.muted, { textAlign: 'center' }]}>Add riders by their username, or scan their QR code.</Text>
          </Card>
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {sorted.map((f, i) => (
              <Divided key={f.id} index={i}>
                <RiderRow rider={f} sub={statusText(f.status, f.minutesAgo)} />
              </Divided>
            ))}
          </Card>
        )}

        <Text style={[styles.hint, { textAlign: 'center' }]}>Only accepted friends can see your active status.</Text>
      </Screen>
      <ScanQrSheet visible={scanOpen} onClose={() => setScanOpen(false)} />
    </>
  );
}

export default function FriendsTab() {
  const { mode, account } = useAuth();
  if (mode !== 'account' || !account) {
    return (
      <Screen>
        <LoginForFriendsCard />
      </Screen>
    );
  }
  return <FriendsList userId={account.userId} />;
}

const local = themedStyles((colors) => ({
  action: { flex: 1, paddingHorizontal: 6 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  chevron: { color: colors.muted, fontSize: 24, marginLeft: 4 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  // Same height and outline as the Active status pill next to it.
  iconPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
}));
