import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, Chip, Field, Screen, styles } from '../../../../components/ui';
import { fmtDate } from '../../../../lib/format';
import { albumMeta, allAlbums, fmtDuration, mediaUri } from '../../../../lib/photos';
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
                onPress={() => updatePhoto(photo.id, { album: a.id })}
              />
            ))}
          </View>
          {bikes.length > 1 && (
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
