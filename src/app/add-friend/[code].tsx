import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { LoginForFriendsCard, OfflineNotice, RiderCard } from '../../components/Friends';
import { Button, Card, Screen, styles } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { api, errorText, markOffline, Rider, savePendingCode } from '../../lib/friends';
import { useStore } from '../../lib/store';
import { colors } from '../../lib/theme';

// Opened by motopms://add-friend/<code> (and by the in-app QR scanner). Reachable even when logged out:
// the code is kept, and the card opens again right after logging in.

const CODE_RE = /^[2-9A-HJKMNP-Z]{8}$/;

function NotFound({ message }: { message: string }) {
  return (
    <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
      <Text style={{ fontSize: 32 }}>🔍</Text>
      <Text style={styles.title}>Rider not found</Text>
      <Text style={[styles.muted, { textAlign: 'center' }]}>{message}</Text>
    </Card>
  );
}

function SaveQrButton({ img, w, h, code, caption }: { img: string; w?: string; h?: string; code: string; caption: string }) {
  const { addQrImage } = useStore();
  const [saved, setSaved] = useState(false);
  const save = () => {
    try {
      addQrImage({ uri: img, width: Number(w) || undefined, height: Number(h) || undefined, qr: { code }, caption });
      setSaved(true);
    } catch (e) {
      console.warn('Failed to save QR image', e);
    }
  };
  return (
    <Button
      title={saved ? '✓ Saved to 🔳 QR / Friends' : '💾 Save to QR / Friends'}
      variant="ghost"
      onPress={save}
      disabled={saved}
    />
  );
}

function FoundByCode({ code, img, w, h }: { code: string; img?: string; w?: string; h?: string }) {
  const [rider, setRider] = useState<Rider | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.findByCode(code).then((r) => {
      if (!alive) return;
      if (r.ok) {
        markOffline(false);
        setRider(r.data);
      } else {
        if (r.error === 'network') markOffline(true);
        setError(errorText(r.error));
      }
    });
    return () => {
      alive = false;
    };
  }, [code]);

  if (error) {
    return (
      <Card>
        <Text style={styles.muted}>{error}</Text>
      </Card>
    );
  }
  if (rider === undefined) return <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />;
  if (rider === null) return <NotFound message="This QR code doesn’t work any more, or the rider isn’t available." />;
  return (
    <RiderCard
      rider={rider}
      add={() => api.addByCode(code)}
      footer={
        img && rider.relation !== 'self' ? (
          <SaveQrButton img={img} w={w} h={h} code={code} caption={rider.username ? `@${rider.username}` : rider.fullName} />
        ) : null
      }
    />
  );
}

export default function AddFriendLink() {
  const params = useLocalSearchParams<{ code: string; img?: string; w?: string; h?: string }>();
  const { mode, account } = useAuth();
  const code = String(params.code ?? '').toUpperCase();
  const valid = CODE_RE.test(code);
  const usable = mode === 'account' && !account?.mustChangePassword;

  useEffect(() => {
    if (valid && !usable) savePendingCode(code);
  }, [valid, usable, code]);

  if (!valid) {
    return (
      <Screen>
        <NotFound message="This friend link isn’t valid." />
      </Screen>
    );
  }
  if (mode === 'account' && account?.mustChangePassword) {
    return (
      <Screen>
        <Card style={{ gap: 10 }}>
          <Text style={styles.body}>Set your new password first. Then this rider’s card opens.</Text>
          <Button title="Change password" onPress={() => router.replace('/change-password')} />
        </Card>
      </Screen>
    );
  }
  if (!usable) {
    return (
      <Screen>
        <LoginForFriendsCard message="Log in to add this rider" />
        <Text style={[styles.hint, { textAlign: 'center' }]}>After you log in, their card opens so you can send a request.</Text>
      </Screen>
    );
  }
  return (
    <Screen>
      <OfflineNotice />
      <FoundByCode code={code} img={params.img} w={params.w} h={params.h} />
    </Screen>
  );
}
