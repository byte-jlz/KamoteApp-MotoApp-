import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { MediaGallery } from '../../../components/MediaGallery';
import { Screen, styles } from '../../../components/ui';
import { useBike } from '../../../lib/store';

export default function BikeGallery() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bike = useBike(id);

  if (!bike) {
    return (
      <Screen>
        <Text style={styles.muted}>Motorcycle not found.</Text>
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: `${bike.name} · Gallery` }} />
      <MediaGallery bikeId={bike.id} />
    </>
  );
}
