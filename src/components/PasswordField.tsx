import { useState } from 'react';
import { Pressable, Text, TextInputProps, View } from 'react-native';
import { colors } from '../lib/theme';
import { Field } from './ui';

/** A password input with a Show/Hide toggle. */
export function PasswordField(props: TextInputProps & { label: string; hint?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <View>
      <Field
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        {...props}
        secureTextEntry={!shown}
        style={{ paddingRight: 64 }}
      />
      <Pressable
        onPress={() => setShown((s) => !s)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={shown ? 'Hide password' : 'Show password'}
        style={{ position: 'absolute', right: 12, top: 36 }}
      >
        <Text style={{ color: colors.primary, fontWeight: '600', paddingVertical: 4 }}>{shown ? 'Hide' : 'Show'}</Text>
      </Pressable>
    </View>
  );
}
