import { Alert, StyleProp, ViewStyle } from 'react-native';
import { useAuth } from '../lib/auth';
import { Button } from './ui';

/** Log out with a confirmation. Used on the Profile tab and the Account screen. */
export function LogOutButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { signOut } = useAuth();
  const logOut = () =>
    Alert.alert('Log out?', 'Your records stay saved on this phone and come back when you log in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => signOut() },
    ]);
  return <Button title="Log out" variant="danger" onPress={logOut} style={style} />;
}
