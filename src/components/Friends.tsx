import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from 'react-native';
import {
  ActionResult,
  actionText,
  api,
  displayName,
  errorText,
  markOffline,
  OnlineStatus,
  refreshFriends,
  Result,
  Rider,
  runAction,
  statusText,
  useFriends,
} from '../lib/friends';
import { fmtAgo } from '../lib/format';
import { colors, themedStyles } from '../lib/theme';
import { initials } from './Avatar';
import { NudgePanel } from './Nudges';
import { Button, Card, styles } from './ui';

/** Initials in a circle, with a green dot when online. */
export function FriendAvatar({ name, status, size = 44 }: { name: string; status?: OnlineStatus | null; size?: number }) {
  const dot = Math.max(12, size * 0.28);
  return (
    <View style={{ width: size, height: size }}>
      <View style={[local.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={{ fontSize: size * 0.38, fontWeight: '700', color: colors.muted }}>{initials(name) || '🏍️'}</Text>
      </View>
      {status === 'online' && (
        <View
          accessibilityLabel="Online"
          style={[local.dot, { width: dot, height: dot, borderRadius: dot / 2 }]}
        />
      )}
    </View>
  );
}

/** Shown when the last refresh had no internet: the list may be old, and buttons are disabled. */
export function OfflineNotice() {
  const { offline, loadedAt } = useFriends();
  if (!offline) return null;
  return (
    <Card style={{ backgroundColor: colors.warnBg, borderColor: colors.warnBg, gap: 2 }}>
      <Text style={[styles.body, { color: colors.warn, fontWeight: '600' }]}>📴 Offline – statuses may be out of date</Text>
      {loadedAt ? <Text style={[styles.hint, { color: colors.warn, marginTop: 0 }]}>Last updated {fmtAgo(loadedAt)}</Text> : null}
    </Card>
  );
}

/**
 * Small "Active status" toggle (show my online status). Stored on the server so it applies on every phone; the last known
 * value is kept on this phone so the switch shows something offline. Off works both ways, like Messenger.
 */
export function ActiveStatusToggle({ userId }: { userId: string }) {
  const { offline } = useFriends();
  const key = `motopms:showOnline:v1:${userId}`;
  const [value, setValue] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(key)
      .then((v) => alive && v !== null && setValue((prev) => prev ?? v === 'true'))
      .catch(() => {});
    api.getShowOnline().then((r) => {
      if (!alive) return;
      if (r.ok) {
        setValue(r.data);
        AsyncStorage.setItem(key, String(r.data)).catch(() => {});
      } else if (r.error === 'network') {
        markOffline(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [key]);

  const change = async (v: boolean) => {
    if (!v) {
      const ok = await confirm(
        'Turn off active status?',
        'Friends will see you as offline, and you’ll see them as offline too.',
        'Turn off',
        false,
      );
      if (!ok) return;
    }
    setBusy(true);
    const r = await api.setShowOnline(v);
    setBusy(false);
    if (!r.ok) {
      if (r.error === 'network') markOffline(true);
      return Alert.alert('Couldn’t change it', errorText(r.error));
    }
    setValue(v);
    AsyncStorage.setItem(key, String(v)).catch(() => {});
    refreshFriends(); // friends' statuses change too (off = everyone shows as offline)
  };

  const on = value ?? true;
  return (
    <View style={local.statusPill}>
      <View style={[local.statusLamp, { backgroundColor: on ? colors.ok : colors.muted }]} />
      <Text style={[styles.muted, { fontSize: 13, fontWeight: '600' }]}>{on ? 'Active' : 'Hidden'}</Text>
      <Switch
        accessibilityLabel="Active status: show friends when I’m online"
        value={on}
        onValueChange={change}
        disabled={busy || offline || value === null}
        trackColor={{ true: colors.ok }}
        style={{ transform: [{ scale: 0.8 }], marginVertical: -8, marginRight: -6 }}
      />
    </View>
  );
}

/** Guests don't get friends; they see this instead. */
export function LoginForFriendsCard({ message = 'Log in to add friends' }: { message?: string }) {
  return (
    <Card style={{ gap: 10, alignItems: 'center', paddingVertical: 24 }}>
      <Text style={{ fontSize: 36 }}>👥</Text>
      <Text style={styles.title}>{message}</Text>
      <Text style={[styles.muted, { textAlign: 'center' }]}>
        With a free account you can add riders as friends and see when they’re online.
      </Text>
      <View style={[styles.row, { gap: 10, alignSelf: 'stretch' }]}>
        <Button title="Log in" variant="secondary" onPress={() => router.push('/login')} style={{ flex: 1 }} />
        <Button title="Create account" onPress={() => router.push('/signup')} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

/** One row in a list of riders; tapping opens their card. */
export function RiderRow({ rider, sub, right }: { rider: Pick<Rider, 'id' | 'fullName' | 'username' | 'status'>; sub?: string; right?: ReactNode }) {
  const name = displayName(rider);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, sub].filter(Boolean).join(', ')}
      onPress={() => router.push({ pathname: '/rider/[id]', params: { id: rider.id } })}
      style={({ pressed }) => [local.row, pressed && { opacity: 0.6 }]}
    >
      <FriendAvatar name={rider.fullName || rider.username || ''} status={rider.status} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={[styles.body, { fontWeight: '600' }]}>
          {name}
        </Text>
        <Text numberOfLines={1} style={[styles.muted, { fontSize: 13 }, rider.status === 'online' && { color: colors.ok }]}>
          {[rider.fullName.trim() && rider.username ? `@${rider.username}` : null, sub].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {right ?? <Text style={local.chevron}>›</Text>}
    </Pressable>
  );
}

function confirm(title: string, message: string, action: string, destructive = true) {
  return new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]),
  );
}

/**
 * The rider card: name, username, status (friends only) and the buttons that fit our relation:
 * Add / Cancel / Accept & Decline / Unfriend, plus Block. `add` replaces the normal Add (e.g. add by QR code).
 */
export function RiderCard({ rider: initial, add, footer }: { rider: Rider; add?: () => Promise<Result<ActionResult>>; footer?: ReactNode }) {
  const { offline } = useFriends();
  const [rider, setRider] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [gone, setGone] = useState(false);
  const name = displayName(rider);
  const handle = rider.username ? `@${rider.username}` : name;

  /** Reload from the server after a change (status appears once we're friends). */
  const reload = async () => {
    const r = await api.getRider(rider.id);
    if (r.ok) {
      markOffline(false);
      if (r.data) setRider({ ...r.data, quick: false });
      else setGone(true);
    }
  };

  const act = async (fn: () => Promise<Result<ActionResult>>, after?: (res: ActionResult) => void) => {
    setBusy(true);
    try {
      const r = await runAction(fn);
      if (!r.ok) return Alert.alert('Couldn’t do that', errorText(r.error));
      if (r.data === 'not_found') {
        setGone(true);
        return;
      }
      const msg = actionText(r.data);
      if (r.data === 'rate_limited' || r.data === 'already_requested' || r.data === 'already_friends') Alert.alert(msg ?? '');
      after?.(r.data);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const addFriend = () => act(add ?? (() => api.send(rider.id)), (res) => res === 'accepted' && Alert.alert('You’re now friends 🎉', `You and ${name} are friends.`));
  const cancel = () => act(() => api.cancel(rider.id));
  const accept = () => act(() => api.respond(rider.id, true));
  const decline = () => act(() => api.respond(rider.id, false));
  const unfriend = async () => {
    if (await confirm(`Unfriend ${handle}?`, 'You’ll stop seeing each other’s online status. You can add each other again later.', 'Unfriend')) {
      act(() => api.unfriend(rider.id));
    }
  };
  const block = async () => {
    const ok = await confirm(
      `Block ${handle}?`,
      'They won’t be able to find you or send you friend requests. Any friendship or request between you is removed. They aren’t told.',
      'Block',
    );
    if (!ok) return;
    setBusy(true);
    const r = await runAction(() => api.block(rider.id));
    setBusy(false);
    if (!r.ok) return Alert.alert('Couldn’t block', errorText(r.error));
    setBlocked(true);
  };
  const unblock = async () => {
    setBusy(true);
    const r = await runAction(() => api.unblock(rider.id));
    setBusy(false);
    if (!r.ok) return Alert.alert('Couldn’t unblock', errorText(r.error));
    setBlocked(false);
    reload();
  };

  if (gone) {
    return (
      <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
        <Text style={{ fontSize: 32 }}>🔍</Text>
        <Text style={styles.title}>Rider not found</Text>
        <Text style={[styles.muted, { textAlign: 'center' }]}>This rider isn’t available.</Text>
      </Card>
    );
  }

  const off = busy || offline;
  const status = rider.relation === 'friends' ? statusText(rider.status, rider.minutesAgo) : null;

  return (
    <>
      <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
        <FriendAvatar name={rider.fullName || rider.username || ''} status={blocked ? null : rider.status} size={80} />
        <Text style={[styles.title, { fontSize: 22, textAlign: 'center' }]}>{name}</Text>
        {rider.username && rider.fullName.trim() ? <Text style={styles.muted}>@{rider.username}</Text> : null}
        {status && !blocked ? (
          <Text style={[styles.body, { color: rider.status === 'online' ? colors.ok : colors.muted, fontWeight: '600' }]}>
            {rider.status === 'online' ? '● ' : ''}
            {status}
          </Text>
        ) : null}
        {blocked ? <Text style={[styles.body, { color: colors.danger, fontWeight: '600' }]}>⛔ Blocked</Text> : null}
        {!blocked && rider.relation === 'outgoing' ? <Text style={styles.muted}>Friend request sent</Text> : null}
        {!blocked && rider.relation === 'incoming' ? <Text style={styles.muted}>Wants to be your friend</Text> : null}
        {!blocked && rider.quick && rider.relation === 'none' ? (
          <Text style={[styles.hint, { textAlign: 'center' }]}>⚡ Quick add: you’ll be friends right away.</Text>
        ) : null}
        {busy ? <ActivityIndicator color={colors.primary} style={{ marginTop: 4 }} /> : null}
      </Card>

      {rider.relation === 'self' ? (
        <Card>
          <Text style={[styles.body, { textAlign: 'center' }]}>This is you 🙂</Text>
        </Card>
      ) : blocked ? (
        <Button title="Unblock" variant="secondary" onPress={unblock} disabled={off} />
      ) : (
        <View style={{ gap: 10 }}>
          {rider.relation === 'friends' && <NudgePanel rider={rider} />}
          {rider.relation === 'none' && <Button title="➕ Add friend" onPress={addFriend} disabled={off} />}
          {rider.relation === 'outgoing' && <Button title="Cancel request" variant="secondary" onPress={cancel} disabled={off} />}
          {rider.relation === 'incoming' && (
            <View style={[styles.row, { gap: 10 }]}>
              <Button title="Accept" onPress={accept} disabled={off} style={{ flex: 1 }} />
              <Button title="Decline" variant="secondary" onPress={decline} disabled={off} style={{ flex: 1 }} />
            </View>
          )}
          {rider.relation === 'friends' && <Button title="Unfriend" variant="secondary" onPress={unfriend} disabled={off} />}
          <Button title="⛔ Block" variant="danger" onPress={block} disabled={off} />
        </View>
      )}
      {footer}
    </>
  );
}

const local = themedStyles((colors) => ({
  avatar: { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: 0, bottom: 0, backgroundColor: colors.ok, borderWidth: 2, borderColor: colors.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  chevron: { color: colors.muted, fontSize: 24, marginLeft: 4 },
  statusLamp: { width: 10, height: 10, borderRadius: 5 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
}));
