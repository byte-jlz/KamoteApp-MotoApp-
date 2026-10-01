import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { Button, Card, Checkbox, DateField, Field, Screen, SectionTitle, styles } from '../../../components/ui';
import { fmtKm, parseNum } from '../../../lib/format';
import { dueText, sortedItems } from '../../../lib/status';
import { useBike, useStore } from '../../../lib/store';

export default function LogService() {
  const { id, itemId } = useLocalSearchParams<{ id: string; itemId?: string }>();
  const bike = useBike(id);
  const { logService } = useStore();

  const [date, setDate] = useState(new Date());
  const [km, setKm] = useState(String(bike?.odometer ?? ''));
  const [selected, setSelected] = useState<string[]>(itemId ? [itemId] : []);
  const [cost, setCost] = useState('');
  const [shop, setShop] = useState('');
  const [notes, setNotes] = useState('');

  if (!bike) {
    return (
      <Screen>
        <Text style={styles.muted}>Motorcycle not found.</Text>
      </Screen>
    );
  }

  const items = sortedItems(bike).filter((x) => x.s.status !== 'off' || selected.includes(x.item.id));
  const toggle = (iid: string) => setSelected((cur) => (cur.includes(iid) ? cur.filter((x) => x !== iid) : [...cur, iid]));

  const save = () => {
    const kmNum = parseNum(km);
    if (kmNum === null) return Alert.alert('Odometer needed', 'Enter the odometer reading at the time of service.');
    if (selected.length === 0) return Alert.alert('Nothing selected', 'Tick at least one maintenance item you had done.');
    logService(bike.id, {
      date: date.toISOString(),
      km: kmNum,
      itemIds: selected,
      cost: parseNum(cost),
      shop: shop.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    router.back();
  };

  return (
    <Screen>
      <Card>
        <DateField label="Service date" value={date} onChange={setDate} />
        <Field
          label="Odometer (km)"
          value={km}
          onChangeText={setKm}
          keyboardType="number-pad"
          hint={`Current: ${fmtKm(bike.odometer)}`}
        />
      </Card>

      <SectionTitle>What was done?</SectionTitle>
      <Card style={{ paddingVertical: 6 }}>
        {items.map(({ item, s }) => (
          <Checkbox
            key={item.id}
            label={item.name}
            sub={s.status === 'off' ? undefined : dueText(s)}
            checked={selected.includes(item.id)}
            onPress={() => toggle(item.id)}
          />
        ))}
      </Card>

      <Card>
        <Field label="Total cost (₱, optional)" value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="0" />
        <Field label="Shop / mechanic (optional)" value={shop} onChangeText={setShop} placeholder="e.g. Honda 3S Shop" />
        <Field
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="e.g. Used Motul 10W-40, 0.8L"
          multiline
          style={{ minHeight: 70, textAlignVertical: 'top' }}
        />
      </Card>

      <Button title={`Save service${selected.length > 1 ? ` (${selected.length} items)` : ''}`} onPress={save} />
    </Screen>
  );
}
