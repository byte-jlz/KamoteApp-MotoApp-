import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hideBanner, repliesFor, sendErrorText, sendReply, showBanner, useBanner } from '../lib/nudges';
import { colors, themedStyles } from '../lib/theme';
import { styles } from './ui';

/** Top-of-screen banner for nudges, alarms and replies that arrive while the app is open, with quick replies. */
export function NudgeBanner() {
  const b = useBanner();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  if (!b) return null;

  const canReply = (b.kind === 'nudge' || b.kind === 'alarm') && !!b.nudgeId;
  const reply = async (code: string, title: string) => {
    if (!b.nudgeId) return;
    setBusy(true);
    const r = await sendReply(b.nudgeId, code);
    setBusy(false);
    showBanner(r.ok ? { kind: 'info', title: `✅ Reply sent: ${title}`, body: '' } : { kind: 'info', title: '⚠️ Reply not sent', body: sendErrorText(r) });
  };
  const open = () => {
    hideBanner();
    if (b.riderId) router.push({ pathname: '/rider/[id]', params: { id: b.riderId } });
  };

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[local.banner, { top: insets.top + 8 }, b.kind === 'alarm' && { borderColor: colors.danger, borderWidth: 2 }]}
    >
      <View style={[styles.row, { gap: 8, alignItems: 'flex-start' }]}>
        <Pressable onPress={b.riderId ? open : undefined} style={{ flex: 1 }} accessibilityRole={b.riderId ? 'button' : undefined}>
          <Text style={[styles.body, { fontWeight: '700' }]} numberOfLines={2}>
            {b.title}
          </Text>
          {b.body ? (
            <Text style={styles.muted} numberOfLines={3}>
              {b.body}
            </Text>
          ) : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={hideBanner}>
          <Text style={[styles.muted, { fontSize: 18 }]}>✕</Text>
        </Pressable>
      </View>
      {canReply ? (
        <View style={[styles.row, { gap: 6, flexWrap: 'wrap', marginTop: 8 }]}>
          {repliesFor(b.kind).map((r) => (
            <Pressable
              key={r.code}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => reply(r.code, r.title)}
              style={({ pressed }) => [local.reply, (pressed || busy) && { opacity: 0.6 }]}
            >
              <Text style={local.replyText}>{r.title}</Text>
            </Pressable>
          ))}
          {busy ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const local = themedStyles((colors) => ({
  banner: {
    position: 'absolute',
    left: 12,
    right: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  reply: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.primaryBg },
  replyText: { color: colors.primary, fontWeight: '700' },
}));
