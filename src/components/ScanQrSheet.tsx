import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mediaUri, QR_ALBUM } from '../lib/photos';
import { decodeQrImage, parseFriendCode } from '../lib/qr';
import { useStore } from '../lib/store';
import { colors, themedStyles } from '../lib/theme';
import { Button, styles } from './ui';

export const NO_QR_MESSAGE = 'Couldn’t read a QR code. Try again closer, with good light.';

/**
 * Reads a friend QR from an image and opens that rider's card. `saveable` = offer "Save to QR / Friends" there
 * (for photos that aren't in the app's gallery yet). Resolves false if no friend code was found.
 */
export async function scanImage(uri: string, size: { width?: number; height?: number }, saveable: boolean) {
  const text = await decodeQrImage(uri);
  if (!text) {
    Alert.alert('No QR code found', NO_QR_MESSAGE);
    return false;
  }
  const code = parseFriendCode(text);
  if (!code) {
    Alert.alert('Not a MotoMonitor friend code', 'This QR code isn’t a MotoMonitor friend code.');
    return false;
  }
  router.push({
    pathname: '/add-friend/[code]',
    params: saveable ? { code, img: uri, w: String(size.width ?? ''), h: String(size.height ?? '') } : { code },
  });
  return true;
}

/** Bottom sheet: take a photo of a QR, pick one from the phone's gallery, or from the app's QR / Friends category. */
export function ScanQrSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { photos } = useStore();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const saved = photos.filter((p) => p.album === QR_ALBUM && p.kind !== 'video' && !p.qr?.mine);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const fromPicker = async (source: 'camera' | 'library') => {
    if (Platform.OS === 'web') return Alert.alert('Not available', 'Scanning works in the mobile app.');
    let res: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert('Camera blocked', 'Allow camera access in your phone settings.');
      res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    } else {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    }
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    await run(async () => {
      if (await scanImage(a.uri, a, true)) onClose();
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={local.backdrop} onPress={busy ? undefined : onClose} accessibilityLabel="Close" />
      <View style={[local.sheet, { paddingBottom: 20 + insets.bottom }]}>
        <View style={local.handle} />
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={styles.title}>Scan a friend’s QR code</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close" disabled={busy}>
            <Text style={{ color: colors.muted, fontSize: 18 }}>✕</Text>
          </Pressable>
        </View>
        {busy ? (
          <View style={[styles.row, { gap: 12, justifyContent: 'center', paddingVertical: 24 }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.body}>Reading QR code…</Text>
          </View>
        ) : (
          <>
            <Text style={styles.hint}>Take a clear photo of the QR code, or pick a picture of one.</Text>
            <View style={[styles.row, { gap: 8 }]}>
              <Button title="📷 Take photo" onPress={() => fromPicker('camera')} style={{ flex: 1 }} />
              <Button title="🖼️ Pick image" variant="secondary" onPress={() => fromPicker('library')} style={{ flex: 1 }} />
            </View>
            {saved.length > 0 && (
              <>
                <Text style={[styles.label, { marginBottom: 0, marginTop: 4 }]}>From 🔳 QR / Friends</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {saved.map((p) => (
                    <Pressable
                      key={p.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Scan ${p.caption || 'saved QR code'}`}
                      onPress={() =>
                        run(async () => {
                          if (await scanImage(mediaUri(p.fileName), p, false)) onClose();
                        })
                      }
                      style={({ pressed }) => [{ alignItems: 'center', width: 76 }, pressed && { opacity: 0.6 }]}
                    >
                      <Image source={{ uri: mediaUri(p.fileName) }} style={local.thumb} contentFit="cover" />
                      <Text numberOfLines={1} style={[styles.hint, { marginTop: 2 }]}>
                        {p.caption || 'QR'}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

const local = themedStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: -8 },
  thumb: { width: 76, height: 76, borderRadius: 8, backgroundColor: colors.border },
}));
