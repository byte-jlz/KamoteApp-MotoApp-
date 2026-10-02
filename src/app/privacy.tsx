import { ReactNode } from 'react';
import { Linking, Text } from 'react-native';
import { Card, Screen, styles } from '../components/ui';
import { PRIVACY_VERSION } from '../lib/auth';
import { colors } from '../lib/theme';

// DRAFT wording for the app owner to review. If you change what it says about how data is used,
// also bump PRIVACY_VERSION in src/lib/auth.tsx.
// Set this to the email riders should write to about their data (leave '' to say "the app admin").
const CONTACT_EMAIL = '';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card style={{ gap: 6 }}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </Card>
  );
}

function P({ children }: { children: ReactNode }) {
  return <Text style={[styles.body, { lineHeight: 22 }]}>{children}</Text>;
}

export default function Privacy() {
  return (
    <Screen>
      <Text style={styles.muted}>Version {PRIVACY_VERSION}</Text>

      <Section title="In short">
        <P>
          You can use MotoMonitor as a guest. Then everything stays on your phone and nothing about you is sent to us.
        </P>
        <P>
          If you create an account, we keep a copy of your records online so you can back them up and use them on
          another phone. We follow the Philippine Data Privacy Act of 2012 (RA 10173).
        </P>
      </Section>

      <Section title="What we keep if you have an account">
        <P>• Your email address, username and name</P>
        <P>• Your motorcycles, odometer readings, maintenance items and service history</P>
        <P>• Your clubs and your app settings</P>
        <P>• When you signed up and when you last logged in</P>
        <P>
          Your password is never stored in readable form, and nobody (including the app admin) can see it.
        </P>
      </Section>

      <Section title="What stays only on your phone">
        <P>
          Photos, videos, your profile photo and club logos are not uploaded. If you delete the app or log out and
          clear this phone, they are gone.
        </P>
      </Section>

      <Section title="Why we keep it">
        <P>
          Only to run the app for you: back up your records, sync them between your phones, and let you log in. We
          don’t sell your data or use it for ads.
        </P>
      </Section>

      <Section title="Who can see it">
        <P>
          You, and the app admin, who may look at accounts to help riders and keep the app working. Your data is stored
          with Supabase, a cloud database service; its servers may be outside the Philippines.
        </P>
      </Section>

      <Section title="Your rights">
        <P>
          You can see and correct your records in the app at any time. You can delete your account in Settings →
          Account → Delete account. This removes your account and your online records permanently.
        </P>
        {CONTACT_EMAIL ? (
          <Text style={[styles.body, { lineHeight: 22 }]}>
            Questions or requests:{' '}
            <Text style={{ color: colors.primary, fontWeight: '600' }} onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}>
              {CONTACT_EMAIL}
            </Text>
          </Text>
        ) : (
          <P>For questions or requests, contact the app admin.</P>
        )}
      </Section>
    </Screen>
  );
}
