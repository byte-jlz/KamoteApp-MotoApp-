import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Avatar, initials } from '../components/Avatar';
import { Button, Card, Field, Screen, styles } from '../components/ui';
import { mediaUri, pickSquareImage } from '../lib/photos';
import { useStore } from '../lib/store';
import { colors } from '../lib/theme';

export default function ProfileForm() {
  const { profile, updateProfile } = useStore();
  const [fullName, setFullName] = useState(profile.fullName);
  // undefined = keep current photo, null = remove it, string = newly picked image
  const [newPhoto, setNewPhoto] = useState<string | null | undefined>(undefined);

  const shownUri = newPhoto !== undefined ? newPhoto : profile.photoFileName ? mediaUri(profile.photoFileName) : null;

  const choosePhoto = async () => {
    const uri = await pickSquareImage();
    if (uri) setNewPhoto(uri);
  };

  const save = () => {
    try {
      updateProfile(fullName.trim(), newPhoto);
      router.back();
    } catch (e) {
      console.warn('Failed to save profile', e);
      Alert.alert('Could not save', 'Something went wrong saving your photo. Please try again.');
    }
  };

  return (
    <Screen>
      <Card style={{ alignItems: 'center', gap: 10 }}>
        <Pressable onPress={choosePhoto} accessibilityRole="button" accessibilityLabel="Choose profile photo">
          <Avatar uri={shownUri} fallback={initials(fullName) || '📷'} size={104} />
        </Pressable>
        <View style={[styles.row, { gap: 20 }]}>
          <Pressable onPress={choosePhoto} hitSlop={8}>
            <Text style={{ color: colors.primary, fontWeight: '600' }}>📷 {shownUri ? 'Change photo' : 'Add photo'}</Text>
          </Pressable>
          {shownUri && (
            <Pressable onPress={() => setNewPhoto(null)} hitSlop={8}>
              <Text style={{ color: colors.danger, fontWeight: '600' }}>Remove</Text>
            </Pressable>
          )}
        </View>
      </Card>

      <Card>
        <Field
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          placeholder="e.g. Juan Dela Cruz"
          autoCapitalize="words"
          autoComplete="name"
          returnKeyType="done"
          onSubmitEditing={save}
        />
      </Card>

      <Button title="Save" onPress={save} />
    </Screen>
  );
}
