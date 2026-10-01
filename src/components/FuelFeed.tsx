import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { fmtDate } from '../lib/format';
import { FuelState, groupByWeek, refreshFuel } from '../lib/fuel';
import { colors } from '../lib/theme';
import { AdjustmentChip, directionMeta } from './FuelCard';
import { Card, SectionTitle, styles } from './ui';

function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${fmtDate(d)}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** Fuel price announcements: latest adjustment, weekly history and headlines. Used by the side panel and the Fuel screen. */
export function FuelFeed({ fuel, onOpenLink }: { fuel: FuelState; onOpenLink?: () => void }) {
  const { data, error, loading } = fuel;
  const weeks = data ? groupByWeek(data.adjustments) : [];
  const today = data?.fetchedAt.slice(0, 10) ?? '';

  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.row, { justifyContent: 'space-between', gap: 8 }]}>
        <Text style={[styles.muted, { fontSize: 12, flex: 1 }]}>
          {data ? `Last checked ${fmtTime(data.fetchedAt)}` : loading ? 'Checking…' : 'Not checked yet'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh fuel prices"
          onPress={() => refreshFuel(true)}
          disabled={loading}
          hitSlop={8}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6 }, pressed && { opacity: 0.6 }]}
        >
          {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          <Text style={{ color: colors.primary, fontWeight: '600' }}>{loading ? 'Refreshing' : '↻ Refresh'}</Text>
        </Pressable>
      </View>

      {error && (
        <Card style={{ backgroundColor: colors.warnBg, borderColor: colors.warnBg, padding: 12 }}>
          <Text style={[styles.body, { color: colors.warn }]}>
            📶 Can’t reach the server.{data ? ' Showing the last saved prices.' : ''}
          </Text>
        </Card>
      )}

      {!data && loading && <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />}

      {data && weeks.length === 0 && (
        <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 28 }}>
          <Text style={{ fontSize: 36 }}>⛽</Text>
          <Text style={[styles.body, { fontWeight: '600', textAlign: 'center' }]}>No price announcements yet</Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            We check the news every few hours (more often Sunday–Tuesday) and will notify you when gasoline, diesel or
            kerosene prices change.
          </Text>
        </Card>
      )}

      {weeks.map((w, i) => {
        const upcoming = w.date > today;
        const label = upcoming ? '🆕 Upcoming' : i === 0 ? '📌 Current' : '📅 Previous';
        return (
          <Card key={w.date} style={[{ gap: 10, padding: 14 }, i === 0 && { borderColor: colors.primary, borderWidth: 1 }]}>
            <View style={[styles.row, { justifyContent: 'space-between' }]}>
              <Text style={[styles.body, { fontWeight: '700' }]}>{label}</Text>
              <Text style={[styles.muted, { fontSize: 13 }]}>
                {upcoming ? 'Starts ' : ''}
                {fmtDate(new Date(`${w.date}T00:00:00`))}
              </Text>
            </View>
            <View style={[styles.row, { gap: 6 }]}>
              {w.items.map((a) => (
                <AdjustmentChip key={a.id} a={a} />
              ))}
            </View>
          </Card>
        );
      })}

      {data && data.headlines.length > 0 && (
        <>
          <SectionTitle>📰 Headlines</SectionTitle>
          <Card style={{ paddingVertical: 4, paddingHorizontal: 14 }}>
            {data.headlines.map((h, i) => {
              const m = h.direction ? directionMeta(h.direction) : null;
              return (
                <Pressable
                  key={h.id}
                  accessibilityRole="link"
                  onPress={() => {
                    onOpenLink?.();
                    Linking.openURL(h.url);
                  }}
                  style={({ pressed }) => [
                    { flexDirection: 'row', gap: 10, paddingVertical: 12 },
                    i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Text style={{ fontSize: 14, color: m?.fg ?? colors.muted, width: 16, textAlign: 'center' }}>{m?.arrow ?? '•'}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.body, { fontSize: 14 }]}>{h.title}</Text>
                    <Text style={[styles.muted, { fontSize: 12 }]}>
                      {[h.source_name, h.published_at && fmtDate(h.published_at)].filter(Boolean).join(' · ')} ↗
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        </>
      )}

      {weeks.length > 0 && (
        <Text style={[styles.hint, { textAlign: 'center' }]}>Amounts are per liter, from news reports.</Text>
      )}
    </View>
  );
}
