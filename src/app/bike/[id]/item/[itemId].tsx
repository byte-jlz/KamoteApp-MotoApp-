import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { Button, Card, DateField, Field, ProgressBar, Screen, SectionTitle, StatusPill, styles } from '../../../../components/ui';
import { TEMPLATES } from '../../../../lib/defaults';
import { fmtDate, fmtKm, parseNum } from '../../../../lib/format';
import { dueText, itemStatus } from '../../../../lib/status';
import { useBike, useStore } from '../../../../lib/store';
import { colors } from '../../../../lib/theme';

export default function ItemScreen() {
  const { id, itemId } = useLocalSearchParams<{ id: string; itemId: string }>();
  const bike = useBike(id);
  const { saveItem, deleteItem, logs } = useStore();
  const isNew = itemId === 'new';
  const item = bike?.items.find((i) => i.id === itemId);

  const [name, setName] = useState(item?.name ?? '');
  const [enabled, setEnabled] = useState(item?.enabled ?? true);
  const [km, setKm] = useState(item?.intervalKm ? String(item.intervalKm) : '');
  const [months, setMonths] = useState(item?.intervalMonths ? String(item.intervalMonths) : '');
  const [lastKm, setLastKm] = useState(String(item?.lastKm ?? bike?.odometer ?? 0));
  const [lastDate, setLastDate] = useState(item ? new Date(item.lastDate) : new Date());

  if (!bike || (!item && !isNew)) {
    return (
      <Screen>
        <Text style={styles.muted}>Item not found.</Text>
      </Screen>
    );
  }

  const s = item ? itemStatus(bike, item) : null;
  const template = TEMPLATES.find((t) => t.key === item?.key);
  const history = item ? logs.filter((l) => l.bikeId === bike.id && l.itemIds.includes(item.id)) : [];

  const save = () => {
    const intervalKm = parseNum(km);
    const intervalMonths = parseNum(months);
    const last = parseNum(lastKm);
    if (!name.trim()) return Alert.alert('Missing name', 'Give this maintenance item a name.');
    if (!intervalKm && !intervalMonths) return Alert.alert('Missing interval', 'Set a km interval, a month interval, or both.');
    if (last === null) return Alert.alert('Invalid odometer', 'Enter the odometer reading when this was last done.');
    if (last > bike.odometer) {
      return Alert.alert('Check odometer', `Last done at ${fmtKm(last)} is higher than the current odometer (${fmtKm(bike.odometer)}).`);
    }
    saveItem(bike.id, {
      id: item?.id,
      key: item?.key ?? 'custom',
      name: name.trim(),
      description: item?.description,
      intervalKm: intervalKm || null,
      intervalMonths: intervalMonths ? Math.round(intervalMonths) : null,
      enabled,
      lastKm: last,
      lastDate: lastDate.toISOString(),
    });
    router.back();
  };

  const remove = () => {
    if (!item) return;
    Alert.alert('Delete item?', `Remove "${item.name}" from ${bike.name}? Service history is kept.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteItem(bike.id, item.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: isNew ? 'New Item' : item!.name }} />
      <Screen>
        {s && item && s.status !== 'off' && (
          <Card style={{ gap: 8 }}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={styles.title}>{dueText(s)}</Text>
              <StatusPill status={s.status} />
            </View>
            <ProgressBar progress={s.progress} status={s.status} />
            {s.estDate && <Text style={styles.muted}>Estimated due: {fmtDate(s.estDate)}</Text>}
            <Button
              title="✓ Log this service"
              onPress={() => router.push({ pathname: '/bike/[id]/log', params: { id: bike.id, itemId: item.id } })}
              style={{ marginTop: 6 }}
            />
          </Card>
        )}

        {item?.description ? <Text style={[styles.muted, { paddingHorizontal: 4 }]}>{item.description}</Text> : null}

        <Card>
          {(isNew || item?.key === 'custom') && (
            <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Fork oil change" />
          )}
          <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 14 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.body}>Remind me</Text>
              <Text style={styles.hint}>Turn off if this doesn’t apply to your bike.</Text>
            </View>
            <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: colors.primary }} />
          </View>
          <Text style={[styles.label, { marginBottom: 8 }]}>Interval — whichever comes first</Text>
          <View style={[styles.row, { gap: 10 }]}>
            <View style={{ flex: 1 }}>
              <Field label="Every (km)" value={km} onChangeText={setKm} placeholder="—" keyboardType="number-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Every (months)" value={months} onChangeText={setMonths} placeholder="—" keyboardType="number-pad" />
            </View>
          </View>
          {template && (
            <Text style={[styles.hint, { marginTop: -6, marginBottom: 14 }]}>
              Check your owner’s manual — recommended intervals vary by model.
            </Text>
          )}
          <Text style={[styles.label, { marginBottom: 8 }]}>Last done</Text>
          <Field label="At odometer (km)" value={lastKm} onChangeText={setLastKm} keyboardType="number-pad" />
          <DateField label="On date" value={lastDate} onChange={setLastDate} />
        </Card>

        <Button title={isNew ? 'Add item' : 'Save'} onPress={save} />
        {item && <Button title="Delete item" variant="danger" onPress={remove} />}

        {history.length > 0 && (
          <>
            <SectionTitle>History</SectionTitle>
            <Card style={{ paddingVertical: 4 }}>
              {history.map((l, i) => (
                <View key={l.id} style={[{ paddingVertical: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  <Text style={styles.body}>
                    {fmtDate(l.date)} · {fmtKm(l.km)}
                  </Text>
                  {l.shop || l.notes ? <Text style={styles.muted}>{[l.shop, l.notes].filter(Boolean).join(' — ')}</Text> : null}
                </View>
              ))}
            </Card>
          </>
        )}
      </Screen>
    </>
  );
}
