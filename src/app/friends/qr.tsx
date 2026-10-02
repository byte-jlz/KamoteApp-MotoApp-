import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Switch, Text, useWindowDimensions, View } from 'react-native';
import { OfflineNotice } from '../../components/Friends';
import { QrCode } from '../../components/QrCode';
import { Button, Card, Screen, styles } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { api, errorText, markOffline, useFriends } from '../../lib/friends';
import { friendLink, writeQrImage } from '../../lib/qr';
import { useStore } from '../../lib/store';
import { colors } from '../../lib/theme';

const codeKey = (userId: string) => `motopms:myFriendCode:v1:${userId}`;

function deleteTemp(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    // only a temporary file
  }
}

function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function MyQr() {
  const { account } = useAuth();
  const { offline } = useFriends();
  const { addQrImage, replaceMyQrImages } = useStore();
  const { width } = useWindowDimensions();
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState<{ code: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const quickRef = useRef(quick);
  useEffect(() => {
    quickRef.current = quick;
  }, [quick]);

  const userId = account?.userId;
  const caption = account?.username ? `@${account.username}` : '';

  // Show the saved code straight away (works offline), then check with the server.
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    AsyncStorage.getItem(codeKey(userId))
      .then((c) => alive && c && setCode((prev) => prev ?? c))
      .catch(() => {});
    api.myCode().then((r) => {
      if (!alive) return;
      if (r.ok && r.data) {
        markOffline(false);
        setCode(r.data);
        AsyncStorage.setItem(codeKey(userId), r.data).catch(() => {});
      } else if (!r.ok) {
        if (r.error === 'network') markOffline(true);
        setFailed(errorText(r.error));
      }
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  // Quick add countdown; the code is cancelled on the server when it runs out or this screen closes.
  useEffect(() => {
    if (!quick) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= quick.expiresAt) setQuick(null);
    }, 1000);
    return () => clearInterval(t);
  }, [quick]);
  useEffect(() => () => void (quickRef.current && api.cancelQuickCode()), []);

  const toggleQuick = async (on: boolean) => {
    setBusy(true);
    if (on) {
      const r = await api.createQuickCode();
      if (r.ok) setQuick({ code: r.data.code, expiresAt: Date.now() + Math.min(10 * 60_000, new Date(r.data.expiresAt).getTime() - Date.now()) });
      else Alert.alert('Couldn’t turn on Quick add', errorText(r.error));
    } else {
      setQuick(null);
      await api.cancelQuickCode();
    }
    setBusy(false);
  };

  const save = () => {
    if (!code) return;
    try {
      const img = writeQrImage(friendLink(code), caption);
      addQrImage({ uri: img.uri, width: img.width, height: img.height, qr: { code, mine: true }, caption: 'My QR code' });
      deleteTemp(img.uri);
      Alert.alert('Saved', 'Your QR code is in Gallery → 🔳 QR / Friends. It stays on this phone.');
    } catch (e) {
      console.warn('Failed to save QR', e);
      Alert.alert('Couldn’t save', 'Something went wrong. Please try again.');
    }
  };

  const reset = () =>
    Alert.alert(
      'Reset your QR code?',
      'Your current QR code stops working right away, including copies you shared. Friends you already have are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const r = await api.resetCode();
            setBusy(false);
            if (!r.ok) return Alert.alert('Couldn’t reset', errorText(r.error));
            setCode(r.data);
            if (userId) AsyncStorage.setItem(codeKey(userId), r.data).catch(() => {});
            // Saved copies of my old QR would no longer work, so redraw them with the new code.
            let updated = 0;
            try {
              const img = writeQrImage(friendLink(r.data), caption);
              updated = replaceMyQrImages({ uri: img.uri, width: img.width, height: img.height, code: r.data });
              deleteTemp(img.uri);
            } catch (e) {
              console.warn('Failed to update saved QR images', e);
            }
            Alert.alert(
              'New QR code ready',
              `Your old code no longer works.${updated ? ` ${updated === 1 ? 'Your saved QR image was' : `${updated} saved QR images were`} updated in the Gallery.` : ''}`,
            );
          },
        },
      ],
    );

  const shown = quick?.code ?? code;
  const size = Math.min(width - 64, 320);

  return (
    <Screen>
      <OfflineNotice />
      <Card style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }}>
        {shown ? (
          <QrCode value={friendLink(shown)} size={size} />
        ) : (
          <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
            {failed ? <Text style={[styles.muted, { textAlign: 'center' }]}>{failed}</Text> : <ActivityIndicator color={colors.primary} />}
          </View>
        )}
        {caption ? <Text style={[styles.title, { fontSize: 22 }]}>{caption}</Text> : null}
        {quick ? (
          <Text style={[styles.body, { color: colors.primary, fontWeight: '700' }]}>⚡ Quick add · {countdown(quick.expiresAt - now)}</Text>
        ) : (
          <Text style={[styles.muted, { textAlign: 'center' }]}>Riders scan this to send you a friend request.</Text>
        )}
      </Card>

      <Card>
        <View style={[styles.row, { justifyContent: 'space-between', gap: 12 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.body}>Quick add</Text>
            <Text style={styles.hint}>
              Shows a one-time code for 10 minutes. Whoever scans it becomes your friend right away, without you accepting.
            </Text>
          </View>
          <Switch value={!!quick} onValueChange={toggleQuick} disabled={busy || offline || !code} trackColor={{ true: colors.primary }} />
        </View>
      </Card>

      <Button title="💾 Save to Gallery" variant="secondary" onPress={save} disabled={!code || !!quick} />
      <Button title="🔄 Reset my code" variant="ghost" onPress={reset} disabled={busy || offline || !code} />
      <Text style={[styles.hint, { textAlign: 'center' }]}>
        The QR holds only a random code, never your email. Resetting makes the old one stop working.
      </Text>
    </Screen>
  );
}
