import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, Text, View } from 'react-native';
import { OfflineNotice, RiderRow } from '../../components/Friends';
import { Button, Card, Screen, SectionTitle, styles } from '../../components/ui';
import { api, errorText, FriendRow, refreshFriends, runAction, useFriends } from '../../lib/friends';
import { fmtAgo } from '../../lib/format';
import { colors, themedStyles } from '../../lib/theme';

export default function FriendRequests() {
  const { rows, offline } = useFriends();
  const [busy, setBusy] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshFriends();
    }, []),
  );

  const incoming = rows.filter((r) => r.relation === 'incoming');
  const outgoing = rows.filter((r) => r.relation === 'outgoing');

  const act = async (r: FriendRow, fn: () => ReturnType<typeof api.cancel>) => {
    setBusy(r.id);
    const res = await runAction(fn);
    setBusy(null);
    if (!res.ok) Alert.alert('Couldn’t do that', errorText(res.error));
  };

  const pull = async () => {
    setPulling(true);
    await refreshFriends();
    setPulling(false);
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={pulling} onRefresh={pull} colors={[colors.primary]} tintColor={colors.primary} />}>
      <OfflineNotice />

      <SectionTitle>{`Received${incoming.length ? ` (${incoming.length})` : ''}`}</SectionTitle>
      {incoming.length === 0 ? (
        <Card>
          <Text style={styles.muted}>No friend requests right now.</Text>
        </Card>
      ) : (
        incoming.map((r) => (
          <Card key={r.id} style={{ paddingVertical: 4 }}>
            <RiderRow rider={r} sub={fmtAgo(r.since)} />
            <View style={[styles.row, { gap: 10, paddingBottom: 12 }]}>
              <Button title="Accept" onPress={() => act(r, () => api.respond(r.id, true))} disabled={offline || busy === r.id} style={local.btn} />
              <Button
                title="Decline"
                variant="secondary"
                onPress={() => act(r, () => api.respond(r.id, false))}
                disabled={offline || busy === r.id}
                style={local.btn}
              />
            </View>
          </Card>
        ))
      )}

      <SectionTitle>{`Sent${outgoing.length ? ` (${outgoing.length})` : ''}`}</SectionTitle>
      {outgoing.length === 0 ? (
        <Card>
          <Text style={styles.muted}>No pending requests sent.</Text>
        </Card>
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {outgoing.map((r, i) => (
            <View key={r.id} style={i > 0 && local.divider}>
              <RiderRow
                rider={r}
                sub={`Sent ${fmtAgo(r.since)}`}
                right={
                  <Button
                    title="Cancel"
                    variant="ghost"
                    onPress={() => act(r, () => api.cancel(r.id))}
                    disabled={offline || busy === r.id}
                  />
                }
              />
            </View>
          ))}
        </Card>
      )}
      <Text style={[styles.hint, { textAlign: 'center' }]}>Declining doesn’t tell the other rider.</Text>
    </Screen>
  );
}

const local = themedStyles((colors) => ({
  btn: { flex: 1, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
}));
