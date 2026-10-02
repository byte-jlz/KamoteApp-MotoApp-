import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { scanImage } from '../../../../components/ScanQrSheet';
import { Button, Card, Chip, Field, Screen, styles } from '../../../../components/ui';
import { useAuth } from '../../../../lib/auth';
import { fmtDate } from '../../../../lib/format';
import { albumMeta, allAlbums, fmtDuration, mediaUri, NO_BIKE, QR_ALBUM } from '../../../../lib/photos';
import { useStore } from '../../../../lib/store';
import { colors } from '../../../../lib/theme';

function VideoBox({ uri, ratio }: { uri: string; ratio: number }) {
  const player = useVideoPlayer(uri);
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={{ width: '100%', aspectRatio: ratio, borderRadius: 12, backgroundColor: '#000' }}
    />
  );
}

export default function MediaScreen() {
  const { photoId } = useLocalSearchParams<{ id: string; photoId: string }>();
  const { bikes, photos, albums, updatePhoto, deletePhoto } = useStore();
  const photo = photos.find((p) => p.id === photoId);
  const [caption, setCaption] = useState(photo?.caption ?? '');
  const [scanning, setScanning] = useState(false);
  const { mode } = useAuth();

  if (!photo) {
    return (
      <Screen>
        <Text style={styles.muted}>Not found.</Text>
      </Screen>
    );
  }

  const video = photo.kind === 'video';
  const ratio = photo.width && photo.height ? photo.width / photo.height : video ? 16 / 9 : 1;
  const meta = albumMeta(photo.album, albums);
  const isQr = photo.album === QR_ALBUM && !video;
  // QR / Friends photos have no motorcycle; other photos without one can be given one here.
  const showBikes = photo.album !== QR_ALBUM && (bikes.length > 1 || (photo.bikeId === NO_BIKE && bikes.length > 0));

  const scan = async () => {
    if (mode !== 'account') {
      return Alert.alert('Log in to add friends', 'Create a free account or log in, then scan this QR code again.');
    }
    setScanning(true);
    try {
      await scanImage(mediaUri(photo.fileName), photo, false);
    } finally {
      setScanning(false);
    }
  };

  const remove = () =>
    Alert.alert(video ? 'Delete video?' : 'Delete photo?', 'It will be removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deletePhoto(photo.id);
          router.back();
        },
      },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: `${meta.icon} ${meta.label}` }} />
      <Screen>
        {video ? (
          <VideoBox uri={mediaUri(photo.fileName)} ratio={ratio} />
        ) : (
          <Image
            source={{ uri: mediaUri(photo.fileName) }}
            style={{ width: '100%', aspectRatio: ratio, borderRadius: 12, backgroundColor: colors.border }}
            contentFit="contain"
          />
        )}
        {isQr && !photo.qr?.mine && (
          <Button title={scanning ? 'Reading QR code…' : '🔍 Scan / Add friend'} onPress={scan} disabled={scanning} />
        )}
        {scanning && <ActivityIndicator color={colors.primary} />}
        {photo.qr?.mine && (
          <Text style={[styles.hint, { textAlign: 'center' }]}>Your own QR code. It’s redrawn if you reset your code.</Text>
        )}
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          📅 {fmtDate(photo.date)}
          {video && photo.duration ? `  ·  ⏱ ${fmtDuration(photo.duration)}` : ''}
        </Text>

        <Card>
          <Field
            label="Caption"
            value={caption}
            onChangeText={(t) => {
              setCaption(t);
              updatePhoto(photo.id, { caption: t.trim() || undefined });
            }}
            returnKeyType="done"
            placeholder="e.g. Sunday ride to Tagaytay"
          />
          <Text style={[styles.label, { marginBottom: 10 }]}>Category</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {allAlbums(albums).map((a) => (
              <Chip
                key={a.id}
                label={`${a.icon} ${a.label}`}
                selected={photo.album === a.id}
                onPress={() => updatePhoto(photo.id, a.id === QR_ALBUM ? { album: a.id, bikeId: NO_BIKE } : { album: a.id })}
              />
            ))}
          </View>
          {showBikes && (
            <>
              <Text style={[styles.label, { marginTop: 16, marginBottom: 10 }]}>Motorcycle</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {bikes.map((b) => (
                  <Chip
                    key={b.id}
                    label={`🏍️ ${b.name}`}
                    selected={photo.bikeId === b.id}
                    onPress={() => updatePhoto(photo.id, { bikeId: b.id })}
                  />
                ))}
              </View>
            </>
          )}
        </Card>

        <Button title={video ? '🗑️ Delete video' : '🗑️ Delete photo'} variant="danger" onPress={remove} />
      </Screen>
    </>
  );
}
