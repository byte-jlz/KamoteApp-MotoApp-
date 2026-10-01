import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { Button, Card, Field, Screen, styles } from '../components/ui';
import { mediaUri, pickSquareImage } from '../lib/photos';
import { useStore } from '../lib/store';
import { colors } from '../lib/theme';

export default function ClubForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { clubs, saveClub, deleteClub } = useStore();
  const existing = clubs.find((c) => c.id === id);

  const [name, setName] = useState(existing?.name ?? '');
  const [role, setRole] = useState(existing?.role ?? '');
  const [since, setSince] = useState(existing?.since ?? '');
  // undefined = keep current logo, null = remove it, string = newly picked image
  const [newLogo, setNewLogo] = useState<string | null | undefined>(undefined);

  const shownUri = newLogo !== undefined ? newLogo : existing?.logoFileName ? mediaUri(existing.logoFileName) : null;

  const chooseLogo = async () => {
    const uri = await pickSquareImage();
    if (uri) setNewLogo(uri);
  };

  const save = () => {
    if (!name.trim()) return Alert.alert('Missing name', 'Enter the name of your club or team.');
    const year = since.trim();
    if (year && !/^\d{4}$/.test(year)) return Alert.alert('Check the year', 'Enter the year you joined, e.g. 2023.');
    try {
      saveClub({ id: existing?.id, name: name.trim(), role: role.trim() || undefined, since: year || undefined }, newLogo);
      router.back();
    } catch (e) {
      console.warn('Failed to save club', e);
      Alert.alert('Could not save', 'Something went wrong saving the logo. Please try again.');
    }
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert('Remove club?', `Remove ${existing.name} from your profile?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          deleteClub(existing.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: existing ? 'Edit Club' : 'Add Club / Team' }} />
      <Screen>
        <Card style={{ alignItems: 'center', gap: 10 }}>
          <Pressable onPress={chooseLogo} accessibilityRole="button" accessibilityLabel="Choose club logo">
            <Avatar uri={shownUri} fallback="🛡️" size={104} />
          </Pressable>
          <View style={[styles.row, { gap: 20 }]}>
            <Pressable onPress={chooseLogo} hitSlop={8}>
              <Text style={{ color: colors.primary, fontWeight: '600' }}>🖼️ {shownUri ? 'Change logo' : 'Add logo'}</Text>
            </Pressable>
            {shownUri && (
              <Pressable onPress={() => setNewLogo(null)} hitSlop={8}>
                <Text style={{ color: colors.danger, fontWeight: '600' }}>Remove</Text>
              </Pressable>
            )}
          </View>
        </Card>

        <Card>
          <Field
            label="Club / team name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. Click Riders PH"
            autoCapitalize="words"
          />
          <View style={[styles.row, { gap: 10 }]}>
            <View style={{ flex: 1 }}>
              <Field label="Role" value={role} onChangeText={setRole} placeholder="Member" autoCapitalize="words" />
            </View>
            <View style={{ width: 110 }}>
              <Field
                label="Since"
                value={since}
                onChangeText={setSince}
                placeholder="2023"
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
          </View>
        </Card>

        <Button title={existing ? 'Save' : 'Add club'} onPress={save} />
        {existing && <Button title="Remove club" variant="danger" onPress={remove} />}
      </Screen>
    </>
  );
}
