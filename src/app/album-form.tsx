import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Button, Card, Field, Screen, styles } from '../components/ui';
import { ALBUM_ICONS, allAlbums } from '../lib/photos';
import { useStore } from '../lib/store';
import { themedStyles } from '../lib/theme';

export default function AlbumForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { albums, photos, saveAlbum, deleteAlbum } = useStore();
  const existing = albums.find((a) => a.id === id);
  const [label, setLabel] = useState(existing?.label ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? ALBUM_ICONS[0]);

  const save = () => {
    const name = label.trim();
    if (!name) return Alert.alert('Missing name', 'Give your category a name, e.g. Night Rides.');
    const taken = allAlbums(albums).some((a) => a.id !== existing?.id && a.label.toLowerCase() === name.toLowerCase());
    if (taken) return Alert.alert('Already exists', `You already have a "${name}" category.`);
    saveAlbum({ id: existing?.id, label: name, icon });
    router.back();
  };

  const remove = () => {
    if (!existing) return;
    const n = photos.filter((p) => p.album === existing.id).length;
    Alert.alert(
      'Delete category?',
      n ? `Its ${n} item${n === 1 ? '' : 's'} will move to "Other". Nothing is deleted.` : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteAlbum(existing.id);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: existing ? 'Edit Category' : 'New Category' }} />
      <Screen>
        <Card>
          <View style={[styles.row, { gap: 12, marginBottom: 6 }]}>
            <View style={local.preview}>
              <Text style={{ fontSize: 28 }}>{icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Name"
                value={label}
                onChangeText={setLabel}
                placeholder="e.g. Night Rides"
                maxLength={24}
                autoFocus={!existing}
                returnKeyType="done"
                onSubmitEditing={save}
              />
            </View>
          </View>
          <Text style={[styles.label, { marginBottom: 10 }]}>Icon</Text>
          <View style={local.iconGrid}>
            {ALBUM_ICONS.map((i) => (
              <Pressable
                key={i}
                accessibilityLabel={`Icon ${i}`}
                accessibilityState={{ selected: icon === i }}
                onPress={() => setIcon(i)}
                style={[local.iconBtn, icon === i && local.iconBtnOn]}
              >
                <Text style={{ fontSize: 24 }}>{i}</Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Button title={existing ? 'Save' : 'Create category'} onPress={save} />
        {existing && <Button title="Delete category" variant="danger" onPress={remove} />}
      </Screen>
    </>
  );
}

const local = themedStyles((colors) => ({
  preview: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnOn: { borderColor: colors.primary, backgroundColor: colors.primaryBg },
}));
