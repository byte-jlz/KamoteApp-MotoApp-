import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import { colors } from '../lib/theme';

/** Round image (profile photo / club logo) with a text or emoji fallback when there's no image. */
export function Avatar({ uri, fallback, size = 48 }: { uri?: string | null; fallback: string; size?: number }) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.border }}
        contentFit="cover"
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.4, fontWeight: '700', color: colors.muted }}>{fallback}</Text>
    </View>
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
