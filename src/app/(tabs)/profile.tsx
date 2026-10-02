import { ReactNode } from 'react';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Avatar, initials } from '../../components/Avatar';
import { LogOutButton } from '../../components/LogOutButton';
import { Button, Card, Screen, SectionTitle, StatusPill, styles } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { bikeTypeLabel } from '../../lib/defaults';
import { fmtKm } from '../../lib/format';
import { mediaUri } from '../../lib/photos';
import { bikeSummary } from '../../lib/status';
import { useStore } from '../../lib/store';
import { colors, themedStyles } from '../../lib/theme';

function Divided({ index, children }: { index: number; children: ReactNode }) {
  return <View style={index > 0 && local.divider}>{children}</View>;
}

export default function ProfileTab() {
  const { profile, bikes, clubs, photos } = useStore();
  const { mode, account } = useAuth();
  const name = profile.fullName.trim();

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Edit profile"
        onPress={() => router.push('/profile-form')}
        style={({ pressed }) => pressed && { opacity: 0.8 }}
      >
        <Card style={{ alignItems: 'center', gap: 8, paddingVertical: 24 }}>
          <Avatar uri={profile.photoFileName && mediaUri(profile.photoFileName)} fallback={initials(name) || '🏍️'} size={88} />
          <Text style={[styles.title, { fontSize: 22, textAlign: 'center' }, !name && { color: colors.muted }]}>
            {name || 'Add your name'}
          </Text>
          <View style={[styles.row, { gap: 16 }]}>
            <Text style={styles.muted}>🏍️ {bikes.length}</Text>
            <Text style={styles.muted}>🛡️ {clubs.length}</Text>
            <Text style={styles.muted}>📷 {photos.length}</Text>
          </View>
          <Text style={{ color: colors.primary, fontWeight: '600', marginTop: 4 }}>✏️ Edit profile</Text>
        </Card>
      </Pressable>

      {mode === 'guest' && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/signup')}
          style={({ pressed }) => pressed && { opacity: 0.8 }}
        >
          <Card style={[styles.row, { gap: 12 }]}>
            <Text style={{ fontSize: 24 }}>☁️</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.body, { fontWeight: '600' }]}>Back up your records</Text>
              <Text style={[styles.muted, { fontSize: 13 }]}>Create a free account to keep them safe and use another phone.</Text>
            </View>
            <Text style={local.chevron}>›</Text>
          </Card>
        </Pressable>
      )}

      <SectionTitle
        right={
          <Pressable onPress={() => router.push('/bike-form')} hitSlop={8}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>+ Add</Text>
          </Pressable>
        }
      >
        My motorcycles
      </SectionTitle>
      {bikes.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 20 }}>
          <Text style={{ fontSize: 28 }}>🏍️</Text>
          <Text style={styles.muted}>No motorcycles yet</Text>
        </Card>
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {bikes.map((b, i) => {
            const { overdue, soon } = bikeSummary(b);
            return (
              <Divided key={b.id} index={i}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/bike/${b.id}`)}
                  style={({ pressed }) => [local.row, pressed && { opacity: 0.6 }]}
                >
                  <View style={local.iconCircle}>
                    <Text style={{ fontSize: 22 }}>🏍️</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={[styles.body, { fontWeight: '600' }]}>
                      {b.name}
                    </Text>
                    <Text numberOfLines={1} style={[styles.muted, { fontSize: 13 }]}>
                      {[b.make, b.model, b.year].filter(Boolean).join(' ') || bikeTypeLabel(b.type)} · {fmtKm(b.odometer)}
                    </Text>
                  </View>
                  {overdue > 0 ? (
                    <StatusPill status="overdue" label={`! ${overdue}`} />
                  ) : soon > 0 ? (
                    <StatusPill status="soon" label={`⏱ ${soon}`} />
                  ) : null}
                  <Text style={local.chevron}>›</Text>
                </Pressable>
              </Divided>
            );
          })}
        </Card>
      )}

      <SectionTitle
        right={
          <Pressable onPress={() => router.push('/club-form')} hitSlop={8}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>+ Add</Text>
          </Pressable>
        }
      >
        Clubs & Teams
      </SectionTitle>
      {clubs.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 20 }}>
          <Text style={{ fontSize: 28 }}>🛡️</Text>
          <Text style={styles.muted}>Part of a riding club? Add it here.</Text>
          <Button title="+ Add club or team" variant="ghost" onPress={() => router.push('/club-form')} />
        </Card>
      ) : (
        <Card style={{ paddingVertical: 4 }}>
          {clubs.map((c, i) => (
            <Divided key={c.id} index={i}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${c.name}`}
                onPress={() => router.push({ pathname: '/club-form', params: { id: c.id } })}
                style={({ pressed }) => [local.row, pressed && { opacity: 0.6 }]}
              >
                <Avatar uri={c.logoFileName && mediaUri(c.logoFileName)} fallback="🛡️" size={44} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={[styles.body, { fontWeight: '600' }]}>
                    {c.name}
                  </Text>
                  {c.role || c.since ? (
                    <Text numberOfLines={1} style={[styles.muted, { fontSize: 13 }]}>
                      {[c.role, c.since && `since ${c.since}`].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
                <Text style={local.chevron}>›</Text>
              </Pressable>
            </Divided>
          ))}
        </Card>
      )}

      {mode === 'account' && account && (
        <Card style={{ gap: 10, marginTop: 8 }}>
          <Text style={styles.muted}>
            Logged in as{' '}
            <Text style={{ color: colors.text, fontWeight: '600' }}>{account.username ? `@${account.username}` : account.email}</Text>
          </Text>
          <LogOutButton />
        </Card>
      )}
    </Screen>
  );
}

const local = themedStyles((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: { color: colors.muted, fontSize: 24, marginLeft: 4 },
}));
