import { Link, router, Stack } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, ProgressBar, Screen, StatusPill, styles } from '../components/ui';
import { bikeTypeLabel } from '../lib/defaults';
import { fmtKm } from '../lib/format';
import { bikeSummary, dueText, sortedItems } from '../lib/status';
import { useStore } from '../lib/store';
import { colors } from '../lib/theme';
import { Bike } from '../lib/types';

function BikeCard({ bike }: { bike: Bike }) {
  const { overdue, soon } = bikeSummary(bike);
  const next = sortedItems(bike).find((x) => x.s.status !== 'off');
  const status = overdue ? 'overdue' : soon ? 'soon' : 'ok';
  const summary = [overdue && `${overdue} overdue`, soon && `${soon} due soon`].filter(Boolean).join(' · ') || 'All good';

  return (
    <Pressable onPress={() => router.push(`/bike/${bike.id}`)} style={({ pressed }) => pressed && { opacity: 0.85 }}>
      <Card style={{ gap: 10 }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>🏍️ {bike.name}</Text>
            <Text style={styles.muted}>
              {[bike.make, bike.model, bike.plate].filter(Boolean).join(' · ') || bikeTypeLabel(bike.type)}
            </Text>
          </View>
          <StatusPill status={status} label={summary} />
        </View>
        <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text }}>{fmtKm(bike.odometer)}</Text>
        {next && (
          <View style={{ gap: 6 }}>
            <Text style={styles.body}>
              Next: <Text style={{ fontWeight: '700' }}>{next.item.name}</Text>
              <Text style={styles.muted}> — {dueText(next.s)}</Text>
            </Text>
            <ProgressBar progress={next.s.progress} status={next.s.status} />
          </View>
        )}
      </Card>
    </Pressable>
  );
}

export default function Garage() {
  const { bikes } = useStore();

  return (
    <>
      <Stack.Screen
        options={{
          title: 'My Garage',
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable hitSlop={12}>
                <Text style={{ color: '#fff', fontSize: 22 }}>⚙︎</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
      <Screen>
        {bikes.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: 40, gap: 10 }}>
            <Text style={{ fontSize: 56 }}>🏍️</Text>
            <Text style={[styles.title, { fontSize: 22 }]}>Welcome to MotoPMS</Text>
            <Text style={[styles.muted, { textAlign: 'center', marginBottom: 10 }]}>
              Add your motorcycle and we’ll remind you when it’s time for an oil change, gear oil, CVT cleaning, chain
              lube and the rest of your preventive maintenance.
            </Text>
            <Button title="+ Add my motorcycle" onPress={() => router.push('/bike-form')} style={{ alignSelf: 'stretch' }} />
          </Card>
        ) : (
          <>
            {bikes.map((b) => (
              <BikeCard key={b.id} bike={b} />
            ))}
            <Button title="+ Add another motorcycle" variant="secondary" onPress={() => router.push('/bike-form')} />
          </>
        )}
      </Screen>
    </>
  );
}
