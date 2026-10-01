import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, Text, View } from 'react-native';
import { applyOtaUpdate, checkForUpdates, currentVersion, UpdateResult } from '../lib/updates';
import { colors } from '../lib/theme';
import { Button, Card, styles } from './ui';

const RECHECK_MS = 30 * 60 * 1000; // re-check when the app comes back to the foreground, at most every 30 min

/** Checks for updates on launch / resume and shows a prompt when one is available. */
export function UpdatePrompt() {
  const [result, setResult] = useState<UpdateResult>({ kind: 'none' });
  const [dismissed, setDismissed] = useState(false);
  const lastCheck = useRef(0);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (Date.now() - lastCheck.current < RECHECK_MS) return;
      lastCheck.current = Date.now();
      const r = await checkForUpdates();
      if (active && r.kind !== 'none') {
        setResult(r);
        setDismissed(false);
      }
    };
    const first = setTimeout(run, 1500); // let the app finish starting first
    const sub = AppState.addEventListener('change', (s) => s === 'active' && run());
    return () => {
      active = false;
      clearTimeout(first);
      sub.remove();
    };
  }, []);

  if (result.kind === 'none' || dismissed) return null;
  const mandatory = result.kind === 'apk' && result.mandatory;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => !mandatory && setDismissed(true)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 }}>
        <Card style={{ gap: 12, padding: 22 }}>
          <Text style={{ fontSize: 40, textAlign: 'center' }}>{result.kind === 'ota' ? '✨' : '⬇️'}</Text>
          {result.kind === 'ota' ? (
            <>
              <Text style={[styles.title, { textAlign: 'center' }]}>Update ready</Text>
              <Text style={[styles.muted, { textAlign: 'center' }]}>
                A new version of MotoPMS has been downloaded. Restart the app to use it — your data is kept.
              </Text>
              <Button title="Restart now" onPress={() => applyOtaUpdate()} />
              <Button title="Later" variant="ghost" onPress={() => setDismissed(true)} />
            </>
          ) : (
            <>
              <Text style={[styles.title, { textAlign: 'center' }]}>
                {mandatory ? 'Update required' : 'New version available'}
              </Text>
              <Text style={[styles.muted, { textAlign: 'center' }]}>
                Version {result.latestVersion} is available (you have {currentVersion()}).
                {mandatory ? ' This version is no longer supported — please update to continue.' : ''}
              </Text>
              {result.releaseNotes ? (
                <Text style={[styles.body, { backgroundColor: colors.bg, padding: 12, borderRadius: 10 }]}>
                  {result.releaseNotes}
                </Text>
              ) : null}
              <Text style={[styles.hint, { textAlign: 'center' }]}>
                Download and open the APK to install it over this version. Your data is kept.
              </Text>
              <Button title="Download update" onPress={() => Linking.openURL(result.downloadUrl)} />
              {!mandatory && <Button title="Later" variant="ghost" onPress={() => setDismissed(true)} />}
            </>
          )}
        </Card>
      </View>
    </Modal>
  );
}
