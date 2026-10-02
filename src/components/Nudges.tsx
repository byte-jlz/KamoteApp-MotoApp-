import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from 'react-native';
import { fmtAgo } from '../lib/format';
import { errorText, markOffline, Rider, useFriends } from '../lib/friends';
import { notificationsAllowed, notificationsSupported } from '../lib/notifications';
import {
  NudgeCard,
  nudgeApi,
  NudgeKind,
  onNudgeActivity,
  repliesFor,
  replyLabel,
  sendErrorText,
  sendReply,
  showAlarmTipOnce,
} from '../lib/nudges';
import { colors, themedStyles } from '../lib/theme';
import { Button, Card, styles } from './ui';

const handleOf = (r: Pick<Rider, 'username' | 'fullName'>) => (r.username ? `@${r.username}` : r.fullName.trim() || 'this rider');

export function openNudge(rider: Pick<Rider, 'id' | 'username' | 'fullName'>, kind: NudgeKind) {
  router.push({ pathname: '/nudge/[id]', params: { id: rider.id, kind, name: handleOf(rider) } });
}

/** 👋 button on a friend row in the Friends list. */
export function NudgeRowButton({ rider }: { rider: Pick<Rider, 'id' | 'username' | 'fullName'> }) {
  const { offline } = useFriends();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Nudge ${handleOf(rider)}`}
      hitSlop={8}
      disabled={offline}
      onPress={() => openNudge(rider, 'nudge')}
      style={({ pressed }) => [local.rowButton, (pressed || offline) && { opacity: 0.5 }]}
    >
      <Text style={{ fontSize: 16 }}>👋</Text>
    </Pressable>
  );
}

/** On a friend's rider card: Nudge / Alarm, answer their latest nudge, see their latest reply, mute. */
export function NudgePanel({ rider }: { rider: Rider }) {
  const { offline } = useFriends();
  const [card, setCard] = useState<NudgeCard | null>(null);
  const [busy, setBusy] = useState(false);
  const name = handleOf(rider);

  const load = useCallback(async () => {
    const r = await nudgeApi.getCard(rider.id);
    if (r.ok) setCard(r.data);
    else if (r.error === 'network') markOffline(true);
  }, [rider.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  useEffect(() => onNudgeActivity(load), [load]);

  const reply = async (code: string) => {
    if (!card?.openNudgeId) return;
    setBusy(true);
    const r = await sendReply(card.openNudgeId, code);
    setBusy(false);
    if (!r.ok) Alert.alert('Reply not sent', sendErrorText(r));
    load();
  };

  const toggleMute = async (muted: boolean) => {
    setBusy(true);
    const r = await nudgeApi.setMute(rider.id, muted);
    setBusy(false);
    if (!r.ok) {
      if (r.error === 'network') markOffline(true);
      return Alert.alert('Couldn’t change it', errorText(r.error));
    }
    setCard((c) => (c ? { ...c, muted: r.data } : c));
  };

  return (
    <>
      <View style={[styles.row, { gap: 10 }]}>
        <Button title="👋 Nudge" variant="secondary" onPress={() => openNudge(rider, 'nudge')} disabled={offline} style={{ flex: 1 }} />
        <Button title="🚨 Alarm" variant="danger" onPress={() => openNudge(rider, 'alarm')} disabled={offline} style={{ flex: 1 }} />
      </View>

      {card?.openNudgeId && card.openNudgeKind ? (
        <Card style={{ gap: 8 }}>
          <Text style={[styles.body, { fontWeight: '600' }]}>
            {card.openNudgeKind === 'alarm' ? '🚨' : '👋'} {name} {card.openNudgeKind === 'alarm' ? 'is calling you' : 'nudged you'}
            {card.openNudgeAt ? <Text style={styles.muted}>{` · ${fmtAgo(card.openNudgeAt)}`}</Text> : null}
          </Text>
          <View style={[styles.row, { gap: 6, flexWrap: 'wrap' }]}>
            {repliesFor(card.openNudgeKind).map((r) => (
              <Pressable
                key={r.code}
                accessibilityRole="button"
                disabled={busy || offline}
                onPress={() => reply(r.code)}
                style={({ pressed }) => [local.reply, (pressed || busy || offline) && { opacity: 0.6 }]}
              >
                <Text style={local.replyText}>{r.title}</Text>
              </Pressable>
            ))}
            {busy ? <ActivityIndicator color={colors.primary} /> : null}
          </View>
        </Card>
      ) : null}

      {card?.lastReplyCode && card.lastReplyAt ? (
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          💬 {name} replied: <Text style={{ fontWeight: '700', color: colors.text }}>{replyLabel(card.lastReplyCode)}</Text>
          {` · ${fmtAgo(card.lastReplyAt)}`}
        </Text>
      ) : null}

      <Card>
        <View style={[styles.row, { justifyContent: 'space-between', gap: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.body}>Mute nudges from {name}</Text>
            <Text style={styles.hint}>Nudges and alarms from them won’t reach you. They aren’t told.</Text>
          </View>
          <Switch
            accessibilityLabel={`Mute nudges from ${name}`}
            value={!!card?.muted}
            onValueChange={toggleMute}
            disabled={!card || busy || offline}
            trackColor={{ true: colors.primary }}
          />
        </View>
      </Card>
    </>
  );
}

/** Settings → Nudges (logged-in riders). Stored on the server so it applies on every phone. */
export function NudgeSettingsCard({ userId }: { userId: string }) {
  const key = `motopms:nudgeSettings:v1:${userId}`;
  const [value, setValue] = useState<{ allowNudges: boolean; allowAlarms: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(key)
      .then((v) => alive && v && setValue((prev) => prev ?? JSON.parse(v)))
      .catch(() => {});
    nudgeApi.getSettings().then((r) => {
      if (!alive || !r.ok) return;
      setValue(r.data);
      AsyncStorage.setItem(key, JSON.stringify(r.data)).catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, [key]);

  // Re-check permission whenever Settings comes back into view (the rider may have just fixed it).
  useFocusEffect(
    useCallback(() => {
      if (notificationsSupported) notificationsAllowed().then(setAllowed);
    }, []),
  );

  const change = async (patch: Partial<{ allowNudges: boolean; allowAlarms: boolean }>) => {
    const next = { allowNudges: true, allowAlarms: true, ...value, ...patch };
    setBusy(true);
    const r = await nudgeApi.setSettings(next.allowNudges, next.allowAlarms);
    setBusy(false);
    if (!r.ok) return Alert.alert('Couldn’t change it', errorText(r.error));
    setValue(r.data);
    AsyncStorage.setItem(key, JSON.stringify(r.data)).catch(() => {});
    if (patch.allowNudges || patch.allowAlarms) showAlarmTipOnce();
  };

  const v = value ?? { allowNudges: true, allowAlarms: true };
  return (
    <Card style={{ gap: 4 }}>
      <Text style={styles.title}>Nudges</Text>
      <SwitchRow
        title="Allow nudges"
        sub="Friends can send you a 👋 nudge, with a short message."
        value={v.allowNudges}
        onChange={(x) => change({ allowNudges: x })}
        disabled={busy || value === null}
      />
      <SwitchRow
        title="Allow alarm nudges"
        sub="Friends can send a loud 🚨 alarm that plays at alarm volume."
        value={v.allowAlarms}
        onChange={(x) => change({ allowAlarms: x })}
        disabled={busy || value === null}
      />
      {!allowed ? (
        <Text style={[styles.hint, { color: colors.warn }]}>
          ⚠️ Notifications are blocked for MotoMonitor on this phone, so nudges can’t show.
        </Text>
      ) : null}
      <Text style={styles.hint}>To mute one friend, open their card on the Friends tab.</Text>
      <Button title="Make sure you get alarms" variant="ghost" onPress={() => router.push('/nudge-help')} />
    </Card>
  );
}

function SwitchRow({
  title,
  sub,
  value,
  onChange,
  disabled,
}: {
  title: string;
  sub: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 8, gap: 12 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.body}>{title}</Text>
        <Text style={styles.hint}>{sub}</Text>
      </View>
      <Switch accessibilityLabel={title} value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.primary }} />
    </View>
  );
}

const local = themedStyles((colors) => ({
  rowButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryBg,
    marginLeft: 4,
  },
  reply: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.primaryBg },
  replyText: { color: colors.primary, fontWeight: '700' },
}));
