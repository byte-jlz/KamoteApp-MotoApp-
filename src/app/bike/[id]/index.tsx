import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Button, Card, Field, ProgressBar, Screen, SectionTitle, styles } from '../../../components/ui';
import { bikeTypeLabel, itemIcon, recommendedItems } from '../../../lib/defaults';
import { fmtDate, fmtKm, fmtNum, parseNum } from '../../../lib/format';
import { dueText, intervalText, ItemStatus, kmPerDay, sortedItems, Status } from '../../../lib/status';
import { useBike, useStore } from '../../../lib/store';
import { colors, themedStyles } from '../../../lib/theme';
import { MaintItem } from '../../../lib/types';

function badgeFor(s: Status) {
  return {
    overdue: { icon: '!', fg: colors.danger, bg: colors.dangerBg },
    soon: { icon: '⏱', fg: colors.warn, bg: colors.warnBg },
    ok: { icon: '✓', fg: colors.ok, bg: colors.okBg },
    off: { icon: '–', fg: colors.muted, bg: colors.offBg },
  }[s];
}

function DueChip({ icon, value, late }: { icon: string; value: string; late: boolean }) {
  return (
    <View style={[styles.row, { gap: 4 }]}>
      <Text style={{ fontSize: 13 }}>{icon}</Text>
      <Text style={{ fontSize: 14, fontWeight: '600', color: late ? colors.danger : colors.muted }}>{value}</Text>
    </View>
  );
}

function ItemRow({ bikeId, item, s }: { bikeId: string; item: MaintItem; s: ItemStatus }) {
  const off = s.status === 'off';
  const badge = badgeFor(s.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${off ? 'off' : dueText(s)}`}
      onPress={() => router.push(`/bike/${bikeId}/item/${item.id}`)}
      style={({ pressed }) => [styles.row, { paddingVertical: 12, gap: 12 }, pressed && { opacity: 0.6 }]}
    >
      <View style={[local.iconCircle, off && { opacity: 0.45 }]}>
        <Text style={{ fontSize: 22 }}>{itemIcon(item.key)}</Text>
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text numberOfLines={1} style={[styles.body, { fontWeight: '600' }, off && { color: colors.muted }]}>
          {item.name}
        </Text>
        {!off && (
          <>
            <View style={[styles.row, { gap: 14 }]}>
              {s.kmLeft !== null && (
                <DueChip icon="🛣️" value={`${fmtNum(Math.abs(s.kmLeft))} km`} late={s.kmLeft <= 0} />
              )}
              {s.daysLeft !== null && (
                <DueChip icon="📅" value={`${Math.abs(s.daysLeft)} d`} late={s.daysLeft <= 0} />
              )}
            </View>
            <ProgressBar progress={s.progress} status={s.status} />
          </>
        )}
      </View>
      <View style={[local.badge, { backgroundColor: badge.bg }]}>
        <Text style={{ color: badge.fg, fontWeight: '800', fontSize: 14 }}>{badge.icon}</Text>
      </View>
    </Pressable>
  );
}

/** An untracked item the rider can add with one tap. */
function PickRow({
  bikeId,
  item,
  important,
  onAdd,
  onDismiss,
}: {
  bikeId: string;
  item: MaintItem;
  important?: boolean;
  onAdd: () => void;
  onDismiss?: () => void;
}) {
  return (
    <View style={[styles.row, { paddingVertical: 12, gap: 10 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${intervalText(item)}`}
        onPress={() => router.push(`/bike/${bikeId}/item/${item.id}`)}
        style={({ pressed }) => [styles.row, { flex: 1, gap: 12 }, pressed && { opacity: 0.6 }]}
      >
        <View style={local.iconCircle}>
          <Text style={{ fontSize: 22 }}>{itemIcon(item.key)}</Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={[styles.body, { fontWeight: '600' }]}>
            {item.name}
          </Text>
          <View style={[styles.row, { gap: 6 }]}>
            {important && (
              <View style={local.importantTag}>
                <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '700' }}>★ Important</Text>
              </View>
            )}
            <Text numberOfLines={1} style={[styles.muted, { fontSize: 13, flexShrink: 1 }]}>
              {intervalText(item)}
            </Text>
          </View>
        </View>
      </Pressable>
      {onDismiss && (
        <Pressable accessibilityLabel={`Hide ${item.name}`} onPress={onDismiss} hitSlop={8} style={local.smallBtn}>
          <Text style={{ color: colors.muted, fontSize: 16 }}>✕</Text>
        </Pressable>
      )}
      <Pressable
        accessibilityLabel={`Track ${item.name}`}
        onPress={onAdd}
        hitSlop={8}
        style={({ pressed }) => [local.addBtn, pressed && { opacity: 0.7 }]}
      >
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 22 }}>+</Text>
      </Pressable>
    </View>
  );
}

function SummaryTile({ status, count }: { status: Status; count: number }) {
  const b = badgeFor(status);
  return (
    <View style={[local.tile, { backgroundColor: b.bg }]}>
      <Text style={{ color: b.fg, fontWeight: '800', fontSize: 20 }}>{count}</Text>
      <Text style={{ color: b.fg, fontSize: 16 }}>{b.icon}</Text>
    </View>
  );
}

const local = themedStyles((colors) => ({
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  importantTag: { backgroundColor: colors.primaryBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  smallBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 10,
  },
}));

export default function BikeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bike = useBike(id);
  const { updateOdometer, trackItems, dismissItem, logs } = useStore();
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
  const recommended = recommendedItems(bike.type, bike.items);
  const others = items.filter((x) => x.s.status === 'off' && !recommended.some((r) => r.item.id === x.item.id));
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
          <Button title="🔧 Log" onPress={() => router.push(`/bike/${bike.id}/log`)} style={{ flex: 1, paddingHorizontal: 8 }} />
          <Button
            title="📋 History"
            variant="secondary"
            onPress={() => router.push(`/bike/${bike.id}/history`)}
            style={{ flex: 1, paddingHorizontal: 8 }}
          />
          <Button
            title="📷 Gallery"
            variant="secondary"
            onPress={() => router.push(`/bike/${bike.id}/photos`)}
            style={{ flex: 1, paddingHorizontal: 8 }}
          />
        </View>

        <SectionTitle>My maintenance</SectionTitle>
        {active.length === 0 ? (
          <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
            <Text style={{ fontSize: 32 }}>🧰</Text>
            <Text style={[styles.body, { fontWeight: '600' }]}>Nothing tracked yet</Text>
            <Text style={styles.muted}>Add items from the list below.</Text>
          </Card>
        ) : (
          <>
            <View style={[styles.row, { gap: 8 }]}>
              <SummaryTile status="overdue" count={active.filter((x) => x.s.status === 'overdue').length} />
              <SummaryTile status="soon" count={active.filter((x) => x.s.status === 'soon').length} />
              <SummaryTile status="ok" count={active.filter((x) => x.s.status === 'ok').length} />
            </View>
            {!hasLogs && (
              <Card style={{ backgroundColor: colors.warnBg, borderColor: colors.warnBg }}>
                <Text style={[styles.body, { color: colors.warn }]}>💡 Tap an item to set when it was last done.</Text>
              </Card>
            )}
            <Card style={{ paddingVertical: 4 }}>
              {active.map(({ item, s }, i) => (
                <View key={item.id} style={i > 0 && local.divider}>
                  <ItemRow bikeId={bike.id} item={item} s={s} />
                </View>
              ))}
            </Card>
          </>
        )}

        {recommended.length > 0 && (
          <>
            <SectionTitle
              right={
                <Pressable onPress={() => trackItems(bike.id, recommended.map((r) => r.item.id))} hitSlop={8}>
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>+ Add all</Text>
                </Pressable>
              }
            >
              ⭐ Recommended
            </SectionTitle>
            <Card style={{ paddingVertical: 4 }}>
              {recommended.map(({ item, important }, i) => (
                <View key={item.id} style={i > 0 && local.divider}>
                  <PickRow
                    bikeId={bike.id}
                    item={item}
                    important={important}
                    onAdd={() => trackItems(bike.id, [item.id])}
                    onDismiss={() => dismissItem(bike.id, item.id)}
                  />
                </View>
              ))}
            </Card>
          </>
        )}

        {others.length > 0 && (
          <>
            <SectionTitle
              right={
                <Pressable onPress={() => setShowOff((v) => !v)} hitSlop={8}>
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>{showOff ? 'Hide' : `Show (${others.length})`}</Text>
                </Pressable>
              }
            >
              More items
            </SectionTitle>
            {showOff && (
              <Card style={{ paddingVertical: 4 }}>
                {others.map(({ item }, i) => (
                  <View key={item.id} style={i > 0 && local.divider}>
                    <PickRow bikeId={bike.id} item={item} onAdd={() => trackItems(bike.id, [item.id])} />
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
