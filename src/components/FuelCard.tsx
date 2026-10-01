import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { fmtDate } from '../lib/format';
import { Direction, FUEL_META, FuelAdjustment, fmtAmount, groupByWeek } from '../lib/fuel';
import { useThemeName } from '../lib/store';
import { useFuel } from '../lib/useFuel';
import { colors } from '../lib/theme';
import { Card, styles } from './ui';

export function directionMeta(d: Direction) {
  if (d === 'up') return { arrow: '▲', fg: colors.danger, bg: colors.dangerBg, word: 'Hike' };
  if (d === 'down') return { arrow: '▼', fg: colors.ok, bg: colors.okBg, word: 'Rollback' };
  return { arrow: '•', fg: colors.muted, bg: colors.offBg, word: 'No change' };
}

export function AdjustmentChip({ a }: { a: FuelAdjustment }) {
  const m = directionMeta(a.direction);
  const f = FUEL_META[a.fuel_type];
  return (
    <View
      accessibilityLabel={`${f.label} ${m.word} ${fmtAmount(a)} per liter`}
      style={{ flex: 1, backgroundColor: m.bg, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center', gap: 2 }}
    >
      <Text style={{ fontSize: 12, color: colors.muted, fontWeight: '600' }}>
        {f.icon} {f.label}
      </Text>
      <Text style={{ fontSize: 16, fontWeight: '800', color: m.fg }}>
        {m.arrow} {a.direction === 'none' ? '—' : fmtAmount(a)}
      </Text>
    </View>
  );
}

/** Latest fuel price adjustment at a glance; tap for history and headlines. */
export function FuelCard() {
  useThemeName();
  const { data } = useFuel();

  const latest = data ? groupByWeek(data.adjustments)[0] : undefined;
  if (!latest) return null; // nothing detected yet (or offline on first launch): keep the garage clean

  const effective = new Date(`${latest.date}T00:00:00`);
  const upcoming = latest.date > data!.fetchedAt.slice(0, 10);

  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/fuel')} style={({ pressed }) => pressed && { opacity: 0.85 }}>
      <Card style={{ gap: 10 }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={[styles.body, { fontWeight: '700' }]}>⛽ Fuel prices</Text>
          <Text style={[styles.muted, { fontSize: 13 }]}>
            {upcoming ? 'Starts' : 'Since'} {fmtDate(effective)} ›
          </Text>
        </View>
        <View style={[styles.row, { gap: 8 }]}>
          {latest.items.map((a) => (
            <AdjustmentChip key={a.id} a={a} />
          ))}
        </View>
        <Text style={[styles.hint, { marginTop: 0 }]}>Per liter · tap for headlines</Text>
      </Card>
    </Pressable>
  );
}
