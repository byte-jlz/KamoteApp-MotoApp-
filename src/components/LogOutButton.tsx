import { useState } from 'react';
import { Alert, StyleProp, ViewStyle } from 'react-native';
import { useAuth } from '../lib/auth';
import { flushStore } from '../lib/store';
import { accountMediaCount, getSyncState, syncNow } from '../lib/sync';
import { Button } from './ui';

const FINAL_SYNC_MS = 10_000;

/** Log out, asking whether to keep a copy of the records on this phone. Used on the Profile tab and the Account screen. */
export function LogOutButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { account, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const confirmRemove = async () => {
    const media = account ? await accountMediaCount(account.userId) : 0;
    const { pending } = getSyncState();
    Alert.alert(
      'Remove from this phone?',
      [
        'Your records will be deleted from this phone. They are still in your account; log in again to get them back.',
        pending ? `⚠️ ${pending} recent change${pending === 1 ? '' : 's'} could not be uploaded and will be lost.` : '',
        media
          ? `⚠️ ${media} photo${media === 1 ? '' : 's'}/video${media === 1 ? '' : 's'} will be deleted for good. Photos and videos are not backed up to your account.`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => signOut('remove') },
      ],
    );
  };

  const start = async () => {
    setBusy(true);
    // Upload the latest changes first, but don't keep the rider waiting if there's no internet.
    await flushStore();
    await Promise.race([syncNow(), new Promise((r) => setTimeout(r, FINAL_SYNC_MS))]);
    setBusy(false);
    const { pending } = getSyncState();
    Alert.alert(
      'Log out',
      [
        'Keep a copy of your records on this phone? You can keep using MotoMonitor offline as a guest.',
        pending
          ? `⚠️ ${pending} recent change${pending === 1 ? ' hasn’t' : 's haven’t'} been uploaded yet (no internet?). Keep a copy so they aren’t lost.`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove from phone', style: 'destructive', onPress: confirmRemove },
        { text: 'Keep a copy', onPress: () => signOut('keep') },
      ],
    );
  };

  return <Button title={busy ? 'Saving your changes…' : 'Log out'} variant="danger" onPress={start} disabled={busy} style={style} />;
}
