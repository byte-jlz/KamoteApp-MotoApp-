import { useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, Text, View } from 'react-native';
import { Card, Screen, styles } from '../../../components/ui';
import { fmtDate, fmtKm, fmtMoney } from '../../../lib/format';
import { useBike, useStore } from '../../../lib/store';
import { colors } from '../../../lib/theme';

export default function History() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bike = useBike(id);
  const { logs, deleteLog } = useStore();

  const bikeLogs = logs
    .filter((l) => l.bikeId === id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.km - a.km);
  const total = bikeLogs.reduce((sum, l) => sum + (l.cost ?? 0), 0);

  const confirmDelete = (logId: string) =>
    Alert.alert('Delete record?', 'This only removes the history entry; reminders are not changed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteLog(logId) },
    ]);

  return (
    <Screen>
      <Card style={[styles.row, { justifyContent: 'space-around' }]}>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.label}>Services</Text>
          <Text style={[styles.title, { fontSize: 24 }]}>{bikeLogs.length}</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.label}>Total spent</Text>
          <Text style={[styles.title, { fontSize: 24 }]}>{fmtMoney(total)}</Text>
        </View>
      </Card>

      {bikeLogs.length === 0 && (
        <Text style={[styles.muted, { textAlign: 'center', marginTop: 20 }]}>
          No services logged yet for {bike?.name ?? 'this motorcycle'}.
        </Text>
      )}

      {bikeLogs.map((l) => (
        <Pressable key={l.id} onLongPress={() => confirmDelete(l.id)}>
          <Card style={{ gap: 4 }}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={styles.title}>{fmtDate(l.date)}</Text>
              {l.cost ? <Text style={[styles.body, { fontWeight: '700' }]}>{fmtMoney(l.cost)}</Text> : null}
            </View>
            <Text style={styles.muted}>
              {fmtKm(l.km)}
              {l.shop ? ` · ${l.shop}` : ''}
            </Text>
            <Text style={[styles.body, { marginTop: 4 }]}>• {l.itemNames.join('\n• ')}</Text>
            {l.notes ? <Text style={[styles.muted, { fontStyle: 'italic', marginTop: 4 }]}>{l.notes}</Text> : null}
          </Card>
        </Pressable>
      ))}

      {bikeLogs.length > 0 && (
        <Text style={[styles.hint, { textAlign: 'center', color: colors.placeholder }]}>Long-press a record to delete it.</Text>
      )}
    </Screen>
  );
}
