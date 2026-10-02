import { useState } from 'react';
import { Text } from 'react-native';
import { OfflineNotice, RiderCard } from '../../components/Friends';
import { Button, Card, Field, Screen, styles } from '../../components/ui';
import { normalizeUsername } from '../../lib/auth';
import { api, errorText, markOffline, Rider, useFriends } from '../../lib/friends';

type Found = { kind: 'idle' } | { kind: 'found'; rider: Rider } | { kind: 'none'; username: string } | { kind: 'error'; message: string };

export default function AddFriend() {
  const { offline } = useFriends();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Found>({ kind: 'idle' });

  const name = normalizeUsername(username).replace(/^@/, '');

  const search = async () => {
    if (!name) return;
    setBusy(true);
    const r = await api.findRider(name);
    setBusy(false);
    if (!r.ok) {
      if (r.error === 'network') markOffline(true);
      return setFound({ kind: 'error', message: errorText(r.error) });
    }
    markOffline(false);
    setFound(r.data ? { kind: 'found', rider: r.data } : { kind: 'none', username: name });
  };

  return (
    <Screen>
      <OfflineNotice />
      <Card>
        <Field
          label="Username"
          value={username}
          onChangeText={(t) => {
            setUsername(t);
            if (found.kind !== 'idle') setFound({ kind: 'idle' });
          }}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          maxLength={21}
          placeholder="e.g. juan_rides"
          returnKeyType="search"
          onSubmitEditing={search}
          hint="Type their exact username. To keep riders private, there’s no browsing or partial search."
        />
        <Button title={busy ? 'Searching…' : 'Find rider'} onPress={search} disabled={busy || !name || offline} />
      </Card>

      {found.kind === 'found' && <RiderCard key={found.rider.id} rider={found.rider} />}
      {found.kind === 'none' && (
        <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 20 }}>
          <Text style={{ fontSize: 28 }}>🔍</Text>
          <Text style={[styles.body, { fontWeight: '600' }]}>No rider with the username @{found.username}</Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>Check the spelling, or ask them for their QR code.</Text>
        </Card>
      )}
      {found.kind === 'error' && (
        <Card>
          <Text style={styles.muted}>{found.message}</Text>
        </Card>
      )}
    </Screen>
  );
}
