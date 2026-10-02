import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { OfflineNotice, RiderCard } from '../../components/Friends';
import { Card, Screen, styles } from '../../components/ui';
import { api, errorText, markOffline, Rider, useFriends } from '../../lib/friends';
import { colors } from '../../lib/theme';

export default function RiderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { rows } = useFriends();
  const [rider, setRider] = useState<Rider | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getRider(id).then((r) => {
      if (!alive) return;
      if (r.ok) {
        markOffline(false);
        setRider(r.data);
      } else {
        if (r.error === 'network') markOffline(true);
        setError(errorText(r.error));
      }
    });
    return () => {
      alive = false;
    };
  }, [id]);

  // Offline: fall back to what the last loaded list knows about this rider.
  const cached = rows.find((r) => r.id === id);
  const shown: Rider | null | undefined =
    rider ?? (error && cached ? { ...cached, relation: cached.relation === 'friend' ? 'friends' : cached.relation } : rider);

  return (
    <Screen>
      <OfflineNotice />
      {shown ? (
        <RiderCard key={`${shown.id}:${shown.relation}`} rider={shown} />
      ) : shown === null ? (
        <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
          <Text style={{ fontSize: 32 }}>🔍</Text>
          <Text style={styles.title}>Rider not found</Text>
        </Card>
      ) : error ? (
        <Card>
          <Text style={styles.muted}>{error}</Text>
        </Card>
      ) : (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      )}
    </Screen>
  );
}
