import { RefreshControl, ScrollView } from 'react-native';
import { FuelFeed } from '../components/FuelFeed';
import { refreshFuel } from '../lib/fuel';
import { colors } from '../lib/theme';
import { useFuel } from '../lib/useFuel';

/** Full-screen version of the fuel feed (opened from the Maintenance card or a fuel notification). */
export default function FuelScreen() {
  const fuel = useFuel();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      refreshControl={
        <RefreshControl
          refreshing={fuel.loading && !!fuel.data}
          onRefresh={() => refreshFuel(true)}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <FuelFeed fuel={fuel} />
    </ScrollView>
  );
}
