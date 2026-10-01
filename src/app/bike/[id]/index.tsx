import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Button, Card, Field, ProgressBar, Screen, SectionTitle, StatusPill, styles } from '../../../components/ui';
import { bikeTypeLabel } from '../../../lib/defaults';
import { fmtDate, fmtKm, fmtNum, parseNum } from '../../../lib/format';
import { dueText, intervalText, ItemStatus, kmPerDay, sortedItems } from '../../../lib/status';
import { useBike, useStore } from '../../../lib/store';
import { colors } from '../../../lib/theme';
import { MaintItem } from '../../../lib/types';

function ItemRow({ bikeId, item, s }: { bikeId: string; item: MaintItem; s: ItemStatus }) {
  const off = s.status === 'off';
  return (
    <Pressable
      onPress={() => router.push(`/bike/${bikeId}/item/${item.id}`)}
      style={({ pressed }) => [{ paddingVertical: 12, gap: 6 }, pressed && { opacity: 0.6 }]}
    >
      <View style={[styles.row, { justifyContent: 'space-between', gap: 8 }]}>
        <Text style={[styles.body, { fontWeight: '700', flex: 1 }, off && { color: colors.muted }]}>{item.name}</Text>
        <StatusPill status={s.status} />
      </View>
      {!off && <ProgressBar progress={s.progress} status={s.status} />}
      <Text style={styles.muted}>
        {off ? intervalText(item) : `${dueText(s)}  ·  last ${fmtKm(item.lastKm)}, ${fmtDate(item.lastDate)}`}
      </Text>
    </Pressable>
  );
}

export default function BikeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bike = useBike(id);
  const { updateOdometer, logs } = useStore();
  const [odo, setOdo] = useState('');
  const [showOff, setShowOff] = useState(false);

  if (!bike) {
    return (
      <Screen>
        <Text style={styles.muted}>Motorcycle not found.</Text>
      </Screen>
    );
  }

  const items = sortedItems(bike);
  const active = items.filter((x) => x.s.status !== 'off');
  const off = items.filter((x) => x.s.status === 'off');
  const rate = kmPerDay(bike);
  const lastReading = bike.readings[bike.readings.length - 1];
  const hasLogs = logs.some((l) => l.bikeId === bike.id);

  const submitOdo = () => {
    const km = parseNum(odo);
    if (km === null) return Alert.alert('Invalid reading', 'Enter your odometer in km, e.g. 12500.');
    const apply = () => {
      updateOdometer(bike.id, km);
      setOdo('');
    };
    if (km < bike.odometer) {
      Alert.alert('Lower than before?', `Your last reading was ${fmtKm(bike.odometer)}. Save ${fmtKm(km)} anyway?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: apply },
      ]);
    } else apply();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: bike.name,
          headerRight: () => (
            <Pressable hitSlop={12} onPress={() => router.push({ pathname: '/bike-form', params: { id: bike.id } })}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Edit</Text>
            </Pressable>
          ),
        }}
      />
      <Screen>
        <Card style={{ gap: 4 }}>
          <Text style={styles.muted}>
            {[bike.make, bike.model, bike.year].filter(Boolean).join(' ') || bike.name} · {bikeTypeLabel(bike.type)}
            {bike.plate ? ` · ${bike.plate}` : ''}
          </Text>
          <Text style={styles.label}>Odometer</Text>
          <Text style={{ fontSize: 34, fontWeight: '800', color: colors.text }}>{fmtKm(bike.odometer)}</Text>
          <Text style={styles.muted}>
            Updated {fmtDate(lastReading?.date ?? bike.createdAt)}
            {rate ? `  ·  ~${fmtNum(rate)} km/day` : ''}
          </Text>
          <View style={[styles.row, { gap: 10, marginTop: 12, alignItems: 'flex-end' }]}>
            <View style={{ flex: 1 }}>
              <Field
                label="New reading"
                value={odo}
                onChangeText={setOdo}
                placeholder={String(bike.odometer)}
                keyboardType="number-pad"
                returnKeyType="done"
                onSubmitEditing={submitOdo}
              />
            </View>
            <Button title="Update" onPress={submitOdo} disabled={!odo} style={{ marginBottom: 14 }} />
          </View>
        </Card>

        <View style={[styles.row, { gap: 10 }]}>
          <Button title="🔧 Log service" onPress={() => router.push(`/bike/${bike.id}/log`)} style={{ flex: 1 }} />
          <Button title="📋 History" variant="secondary" onPress={() => router.push(`/bike/${bike.id}/history`)} style={{ flex: 1 }} />
        </View>

        {!hasLogs && (
          <Card style={{ backgroundColor: colors.warnBg, borderColor: colors.warnBg }}>
            <Text style={[styles.body, { color: colors.warn }]}>
              💡 Tip: We assumed everything was just serviced. Tap an item below to set when it was really last done
              (e.g. your last oil change), so reminders are accurate.
            </Text>
          </Card>
        )}

        <SectionTitle>Maintenance</SectionTitle>
        <Card style={{ paddingVertical: 4 }}>
          {active.length === 0 && <Text style={[styles.muted, { paddingVertical: 12 }]}>No active items.</Text>}
          {active.map(({ item, s }, i) => (
            <View key={item.id} style={i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }}>
              <ItemRow bikeId={bike.id} item={item} s={s} />
            </View>
          ))}
        </Card>

        {off.length > 0 && (
          <>
            <SectionTitle
              right={
                <Pressable onPress={() => setShowOff((v) => !v)} hitSlop={8}>
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>{showOff ? 'Hide' : `Show (${off.length})`}</Text>
                </Pressable>
              }
            >
              Turned off
            </SectionTitle>
            {showOff && (
              <Card style={{ paddingVertical: 4 }}>
                {off.map(({ item, s }, i) => (
                  <View key={item.id} style={i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }}>
                    <ItemRow bikeId={bike.id} item={item} s={s} />
                  </View>
                ))}
              </Card>
            )}
          </>
        )}

        <Button title="+ Add custom item" variant="ghost" onPress={() => router.push(`/bike/${bike.id}/item/new`)} />
      </Screen>
    </>
  );
}
