import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { albumMeta, allAlbums, fmtDuration, isBuiltinAlbum, makeVideoThumb, mediaUri, NO_BIKE, QR_ALBUM } from '../lib/photos';
import { PickedAsset, useStore } from '../lib/store';
import { colors, themedStyles } from '../lib/theme';
import { Album, CustomAlbum, Photo } from '../lib/types';
import { Button, Card, Chip, Screen, styles } from './ui';

const COLS = 3;
const GAP = 4;
// Videos we've already tried to make a preview for this session, so a failure isn't retried on every render.
const thumbTried = new Set<string>();

type Filter = Album | 'all' | 'videos';

function Tile({ p, size, tag }: { p: Photo; size: number; tag?: string }) {
  const video = p.kind === 'video';
  const thumb = video ? p.thumbFileName : p.fileName;
  return (
    <View style={{ width: size, height: size }}>
      {thumb ? (
        <Image source={{ uri: mediaUri(thumb) }} style={[local.tile, { width: size, height: size }]} contentFit="cover" />
      ) : (
        <View style={[local.tile, local.center, { width: size, height: size }]}>
          <Text style={{ fontSize: 28 }}>🎬</Text>
        </View>
      )}
      {tag ? (
        <View style={local.tag}>
          <Text style={{ fontSize: 12 }}>{tag}</Text>
        </View>
      ) : null}
      {video && (
        <View style={local.videoBadge}>
          <Text style={local.videoText}>▶ {p.duration ? fmtDuration(p.duration) : ''}</Text>
        </View>
      )}
    </View>
  );
}

function Label({ children }: { children: string }) {
  return <Text style={[styles.label, { marginBottom: 0 }]}>{children}</Text>;
}

/**
 * Photo/video grid with category filters. Pass `bikeId` to lock it to one motorcycle;
 * leave it out for the all-bikes gallery, which adds a motorcycle filter.
 */
export function MediaGallery({ bikeId }: { bikeId?: string }) {
  const { bikes, photos, albums, addMedia, updatePhoto } = useStore();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [bikeFilter, setBikeFilter] = useState<string | 'all'>(bikeId ?? 'all');
  const [filter, setFilter] = useState<Filter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [targetBike, setTargetBike] = useState<string | undefined>(bikeId);
  const [target, setTarget] = useState<Album>('ride');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const scoped = bikeId ? photos.filter((p) => p.bikeId === bikeId) : photos;

  // Fill in previews for videos saved without one (e.g. an earlier failed attempt).
  useEffect(() => {
    const missing = scoped.filter((p) => p.kind === 'video' && !p.thumbFileName && !thumbTried.has(p.id));
    if (!missing.length) return;
    (async () => {
      for (const p of missing) {
        thumbTried.add(p.id);
        const thumb = await makeVideoThumb(p.fileName);
        if (thumb) updatePhoto(p.id, { thumbFileName: thumb });
      }
    })();
  }, [scoped, updatePhoto]);

  // QR / Friends photos aren't tied to a motorcycle, so a bike's own gallery doesn't offer that category.
  const list = allAlbums(albums).filter((a) => !bikeId || a.id !== QR_ALBUM);
  const multiBike = !bikeId && bikes.length > 1;
  const byBike = bikeFilter === 'all' ? scoped : scoped.filter((p) => p.bikeId === bikeFilter);
  const shown =
    filter === 'all'
      ? byBike
      : filter === 'videos'
        ? byBike.filter((p) => p.kind === 'video')
        : byBike.filter((p) => p.album === filter);
  const videoCount = byBike.filter((p) => p.kind === 'video').length;
  // Screen padding is 16 on each side; inside that, COLS tiles with GAP between.
  const tile = Math.floor((width - 32 - GAP * (COLS - 1)) / COLS);
  const bikeName = (id: string) => bikes.find((b) => b.id === id)?.name ?? '';

  const catMeta = filter !== 'all' && filter !== 'videos' ? albumMeta(filter, albums) : null;
  const catSummary = catMeta ? `${catMeta.icon} ${catMeta.label}` : filter === 'videos' ? '🎬 Videos' : '📷 All';
  const summary = multiBike ? `🏍️ ${bikeFilter === 'all' ? 'All bikes' : bikeName(bikeFilter)}  ·  ${catSummary}` : catSummary;

  const openAdd = () => {
    if (!bikes.length && catMeta?.id !== QR_ALBUM) {
      return Alert.alert('No motorcycle yet', 'Add a motorcycle in the Maintenance tab first.');
    }
    setTargetBike(bikeId ?? (bikeFilter !== 'all' ? bikeFilter : bikes[0]?.id));
    setTarget(catMeta ? catMeta.id : 'ride');
    setAdding(true);
  };

  const pick = async (source: 'photo' | 'video' | 'library') => {
    const destBike = target === QR_ALBUM ? NO_BIKE : targetBike;
    if (destBike === undefined) return Alert.alert('No motorcycle yet', 'Add a motorcycle in the Maintenance tab first.');
    if (Platform.OS === 'web') return Alert.alert('Not available', 'Media is saved on your phone. Use the mobile app.');
    // Close the sheet first; a Modal left open under the system picker misbehaves on iOS.
    setAdding(false);
    let res: ImagePicker.ImagePickerResult;
    if (source === 'library') {
      res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.7,
        allowsMultipleSelection: true,
        selectionLimit: 20,
      });
    } else {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert('Camera blocked', 'Allow camera access in your phone settings.');
      res = await ImagePicker.launchCameraAsync(
        source === 'photo' ? { mediaTypes: ['images'], quality: 0.7 } : { mediaTypes: ['videos'], videoMaxDuration: 180 },
      );
    }
    if (res.canceled || !res.assets.length) return;
    setSaving(true);
    try {
      const saved = await addMedia(destBike, target, res.assets as PickedAsset[]);
      if (saved < res.assets.length) Alert.alert('Some items failed', `Saved ${saved} of ${res.assets.length}.`);
      if (!bikeId) setBikeFilter(destBike === NO_BIKE ? 'all' : destBike);
      setFilter(target);
    } finally {
      setSaving(false);
    }
  };

  const editAlbum = (a: CustomAlbum) => {
    if (!isBuiltinAlbum(a.id)) router.push({ pathname: '/album-form', params: { id: a.id } });
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: filtersOpen }}
          accessibilityLabel={`Filters: ${summary}. ${filtersOpen ? 'Tap to hide' : 'Tap to change'}`}
          onPress={() => setFiltersOpen((v) => !v)}
          style={({ pressed }) => [local.filterBar, pressed && { opacity: 0.7 }]}
        >
          <Text numberOfLines={1} style={[styles.body, { flex: 1, fontWeight: '600' }]}>
            {summary}
            <Text style={styles.muted}>{`  (${shown.length})`}</Text>
          </Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>{filtersOpen ? '▲' : '▼'}</Text>
        </Pressable>

        {filtersOpen && (
          <Card style={{ gap: 10, padding: 12 }}>
            {multiBike && (
              <>
                <Label>Motorcycle</Label>
                <View style={local.chips}>
                  <Chip label={`All bikes · ${scoped.length}`} selected={bikeFilter === 'all'} onPress={() => setBikeFilter('all')} />
                  {bikes.map((b) => {
                    const n = scoped.filter((p) => p.bikeId === b.id).length;
                    return (
                      <Chip
                        key={b.id}
                        label={`🏍️ ${b.name}${n ? ` · ${n}` : ''}`}
                        selected={bikeFilter === b.id}
                        onPress={() => setBikeFilter(b.id)}
                      />
                    );
                  })}
                </View>
                <Label>Category</Label>
              </>
            )}
            <View style={local.chips}>
              <Chip label={`All · ${byBike.length}`} selected={filter === 'all'} onPress={() => setFilter('all')} />
              {videoCount > 0 && (
                <Chip label={`🎬 Videos · ${videoCount}`} selected={filter === 'videos'} onPress={() => setFilter('videos')} />
              )}
              {list.map((a) => {
                const n = byBike.filter((p) => p.album === a.id).length;
                return (
                  <Chip
                    key={a.id}
                    label={`${a.icon} ${a.label}${n ? ` · ${n}` : ''}`}
                    selected={filter === a.id}
                    onPress={() => setFilter(a.id)}
                    onLongPress={() => editAlbum(a)}
                  />
                );
              })}
              <Chip label="+ New" selected={false} onPress={() => router.push('/album-form')} />
            </View>
            <Text style={styles.hint}>Hold a category to edit it</Text>
          </Card>
        )}

        {saving && (
          <Card style={[styles.row, { gap: 12, justifyContent: 'center' }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.body}>Saving to your phone…</Text>
          </Card>
        )}

        {shown.length === 0 ? (
          <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 32 }}>
            <Text style={{ fontSize: 36 }}>{catMeta ? catMeta.icon : filter === 'videos' ? '🎬' : '📷'}</Text>
            <Text style={[styles.body, { fontWeight: '600' }]}>Nothing here yet</Text>
            <Text style={styles.muted}>Tap + to add photos or videos.</Text>
          </Card>
        ) : (
          <View style={local.grid}>
            {shown.map((p) => (
              <Pressable
                key={p.id}
                accessibilityLabel={[
                  p.caption || albumMeta(p.album, albums).label,
                  p.kind === 'video' ? 'video' : 'photo',
                  !bikeId && bikeName(p.bikeId),
                ]
                  .filter(Boolean)
                  .join(', ')}
                onPress={() => router.push(p.bikeId === NO_BIKE ? `/photo/${p.id}` : `/bike/${p.bikeId}/photo/${p.id}`)}
                style={({ pressed }) => pressed && { opacity: 0.7 }}
              >
                <Tile p={p} size={tile} tag={catMeta ? undefined : albumMeta(p.album, albums).icon} />
              </Pressable>
            ))}
          </View>
        )}

        <Text style={[styles.hint, { textAlign: 'center' }]}>🔒 Saved only on this phone</Text>
        {/* Room so the floating + never covers the last row. */}
        <View style={{ height: 56 }} />
      </Screen>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add photos or videos"
        onPress={openAdd}
        disabled={saving}
        // The tab bar already clears the safe area; the per-bike screen sits right on the screen edge.
        style={({ pressed }) => [local.fab, { bottom: 20 + (bikeId ? insets.bottom : 0) }, (pressed || saving) && { opacity: 0.8 }]}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={local.fabText}>+</Text>}
      </Pressable>

      <Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}>
        <Pressable style={local.backdrop} onPress={() => setAdding(false)} accessibilityLabel="Close" />
        <View style={[local.sheet, { paddingBottom: 20 + insets.bottom }]}>
          <View style={local.handle} />
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Text style={styles.title}>Add to gallery</Text>
            <Pressable onPress={() => setAdding(false)} hitSlop={8} accessibilityLabel="Close">
              <Text style={{ color: colors.muted, fontSize: 18 }}>✕</Text>
            </Pressable>
          </View>
          {!bikeId && bikes.length > 1 && target !== QR_ALBUM && (
            <>
              <Label>Motorcycle</Label>
              <View style={local.chips}>
                {bikes.map((b) => (
                  <Chip key={b.id} label={`🏍️ ${b.name}`} selected={targetBike === b.id} onPress={() => setTargetBike(b.id)} />
                ))}
              </View>
            </>
          )}
          <Label>Category</Label>
          <View style={local.chips}>
            {list.map((a) => (
              <Chip key={a.id} label={`${a.icon} ${a.label}`} selected={target === a.id} onPress={() => setTarget(a.id)} />
            ))}
          </View>
          <View style={[styles.row, { gap: 8, marginTop: 4 }]}>
            <Button title="📷 Photo" onPress={() => pick('photo')} style={local.addBtn} />
            <Button title="🎥 Video" onPress={() => pick('video')} style={local.addBtn} />
            <Button title="🖼️ Gallery" variant="secondary" onPress={() => pick('library')} style={local.addBtn} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const local = themedStyles((colors) => ({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  addBtn: { flex: 1, paddingHorizontal: 6 },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { borderRadius: 8, backgroundColor: colors.border },
  center: { alignItems: 'center', justifyContent: 'center' },
  tag: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  videoBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  videoText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: '#fff', fontSize: 30, fontWeight: '600', lineHeight: 32 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 12,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: -8 },
}));
