import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { FriendAvatar, OfflineNotice } from '../../components/Friends';
import { Button, Card, Screen, styles } from '../../components/ui';
import { api, displayName, errorText, markOffline, Rider, runAction, useFriends } from '../../lib/friends';
import { colors } from '../../lib/theme';

export default function BlockedRiders() {
  const { offline } = useFriends();
  const [list, setList] = useState<Rider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.listBlocked().then((r) => {
      if (r.ok) {
        markOffline(false);
        setList(r.data);
      } else {
        if (r.error === 'network') markOffline(true);
        setError(errorText(r.error));
      }
    });
  }, []);

  const unblock = async (rider: Rider) => {
    setBusy(rider.id);
    const r = await runAction(() => api.unblock(rider.id));
    setBusy(null);
    if (!r.ok) return Alert.alert('Couldn’t unblock', errorText(r.error));
    setList((l) => l?.filter((x) => x.id !== rider.id) ?? null);
  };

  return (
    <Screen>
      <OfflineNotice />
      {list === null ? (
        <Card>
          <Text style={styles.muted}>{error ?? 'Loading…'}</Text>
        </Card>
      ) : list.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
          <Text style={{ fontSize: 28 }}>🙂</Text>
          <Text style={styles.muted}>You haven’t blocked anyone.</Text>
        </Card>
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {list.map((r, i) => (
            <View
              key={r.id}
              style={[styles.row, { gap: 12, paddingVertical: 12 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
            >
              <FriendAvatar name={r.fullName || r.username || ''} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={[styles.body, { fontWeight: '600' }]}>
                  {displayName(r)}
                </Text>
                {r.username && r.fullName.trim() ? <Text style={[styles.muted, { fontSize: 13 }]}>@{r.username}</Text> : null}
              </View>
              <Button title="Unblock" variant="ghost" onPress={() => unblock(r)} disabled={offline || busy === r.id} />
            </View>
          ))}
        </Card>
      )}
      <Text style={[styles.hint, { textAlign: 'center' }]}>
        Blocked riders can’t find you or send you friend requests. Unblocking doesn’t make you friends again.
      </Text>
    </Screen>
  );
}
