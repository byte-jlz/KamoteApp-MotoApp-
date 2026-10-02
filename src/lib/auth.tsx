import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthError, isAuthRetryableFetchError, User } from '@supabase/supabase-js';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { dataKeyFor } from './localData';
import { flushStore } from './store';
import { callFunction, supabase } from './supabase';
import { clearAccountData, guestSummary, moveAccountToGuest, moveGuestIntoAccount, stopSync } from './sync';

/** Bump when the privacy notice changes in a way riders should agree to again. */
export const PRIVACY_VERSION = '2026-10';
export const MIN_PASSWORD = 8;

const AUTH_KEY = 'motopms:auth:v1';
const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

/** 'welcome' = hasn't chosen yet; 'guest' = data only on this phone; 'account' = logged in. */
export type AuthMode = 'loading' | 'welcome' | 'guest' | 'account';

export interface Account {
  userId: string;
  email: string;
  username: string | null;
  role: 'rider' | 'admin';
  /** Set by an admin (new account or reset). The app shows nothing else until the password is changed. */
  mustChangePassword: boolean;
  /** Accounts made by an admin never saw the sign-up screen, so they agree to the privacy notice later. */
  needsConsent: boolean;
}

interface Saved {
  mode: 'welcome' | 'guest' | 'account';
  account?: Account;
}

export type AuthResult = { ok: true; needsCode?: boolean } | { ok: false; code?: string; message: string };

export function normalizeUsername(s: string) {
  return s.trim().toLowerCase();
}

export function isValidUsername(s: string) {
  return USERNAME_RE.test(normalizeUsername(s));
}

function messageFor(code?: string, fallback?: string) {
  switch (code) {
    case 'invalid_credentials':
      return 'Wrong email/username or password.';
    case 'email_not_confirmed':
      return 'Please confirm your email first.';
    case 'user_banned':
    case 'account_disabled':
      return 'This account has been disabled. Contact the app admin.';
    case 'temp_expired':
      return 'Your temporary password has expired. Ask the app admin for a new one.';
    case 'too_many_attempts':
    case 'over_request_rate_limit':
      return 'Too many tries. Please wait 15 minutes and try again.';
    case 'over_email_send_rate_limit':
      return 'Too many emails were sent. Please wait a few minutes and try again.';
    case 'otp_expired':
      return 'That code is wrong or has expired. Request a new one.';
    case 'weak_password':
      return `Choose a stronger password (at least ${MIN_PASSWORD} characters).`;
    case 'same_password':
      return 'The new password must be different from the current one.';
    case 'wrong_password':
      return 'Your current password is wrong.';
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Log in instead.';
    case 'username_taken':
      return 'That username is already taken. Try another one.';
    case 'last_admin':
      return 'You are the only admin. Make another account an admin before deleting yours.';
    case 'invalid_username':
      return 'Usernames are 3–20 characters: letters, numbers, dot or underscore.';
    case 'email_address_invalid':
      return 'Enter a valid email address.';
    case 'network':
      return 'No internet connection. Check your connection and try again.';
    default:
      return fallback || 'Something went wrong. Please try again.';
  }
}

function fail(code?: string, fallback?: string): AuthResult {
  return { ok: false, code, message: messageFor(code, fallback) };
}

function fromAuthError(e: AuthError): AuthResult {
  return isAuthRetryableFetchError(e) ? fail('network') : fail(e.code, e.message);
}

/** Reads the rider's profile row (role and flags are only ever set on the server). */
async function loadProfile(user: User) {
  const { data, error } = await supabase
    .from('profiles')
    .select('username, role, must_change_password, temp_password_expires_at, disabled, privacy_consent_at')
    .eq('id', user.id)
    .maybeSingle();
  if (error || !data) return { error: error && /network|fetch/i.test(error.message) ? 'network' : 'unknown' };
  const account: Account = {
    userId: user.id,
    email: user.email ?? '',
    username: data.username,
    role: data.role === 'admin' ? 'admin' : 'rider',
    mustChangePassword: !!data.must_change_password,
    needsConsent: !data.privacy_consent_at,
  };
  const tempExpired =
    account.mustChangePassword &&
    !!data.temp_password_expires_at &&
    new Date(data.temp_password_expires_at).getTime() < Date.now();
  return { account, disabled: !!data.disabled, tempExpired };
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Asked once per login when this phone has guest data. Resolves true for "Upload". */
function askUpload(email: string, s: { bikes: number; logs: number }) {
  return new Promise<boolean>((resolve) =>
    Alert.alert(
      'Upload your existing bikes and records to your account?',
      `This phone has ${plural(s.bikes, 'motorcycle')} and ${plural(s.logs, 'service record')} saved as a guest. ` +
        `Upload them to ${email} to back them up. Nothing already in your account is lost; if a record was changed ` +
        `in both places, the newest change is kept.

` +
        `Not now: they stay on this phone as guest data, and come back if you log out.`,
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Upload', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    ),
  );
}

function useAuthValue() {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const savedRef = useRef<Saved | null>(null);
  const signingOut = useRef(false);

  const persist = useCallback((s: Saved) => {
    savedRef.current = s;
    setSaved(s);
    AsyncStorage.setItem(AUTH_KEY, JSON.stringify(s)).catch((e) => console.warn('Failed to save login state', e));
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(AUTH_KEY)
      .then((raw) => {
        const s: Saved = raw ? JSON.parse(raw) : { mode: 'welcome' };
        savedRef.current = s;
        setSaved(s);
      })
      .catch(() => setSaved({ mode: 'welcome' }));
  }, []);

  /** Forget the session on this phone without changing the app mode (e.g. a login attempt that failed a check). */
  const discardSession = useCallback(async () => {
    signingOut.current = true;
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.warn('Sign out failed', e);
    } finally {
      signingOut.current = false;
    }
  }, []);

  /** Leave the account and go back to the welcome screen. */
  const endSession = useCallback(
    async (message: string | null) => {
      await discardSession();
      setNotice(message);
      persist({ mode: 'welcome' });
    },
    [discardSession, persist],
  );

  // The server ended the session (account deleted, disabled, or logged out everywhere).
  // The rider's data stays on the phone under their account and comes back when they log in again.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' && !signingOut.current && savedRef.current?.mode === 'account') {
        setNotice('You were logged out. Please log in again.');
        persist({ mode: 'welcome' });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [persist]);

  /** Re-read role and flags from the server (an admin may have reset the password or disabled the account). */
  const refreshAccount = useCallback(async () => {
    if (savedRef.current?.mode !== 'account') return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) return; // offline or not refreshed yet; keep what we know
    const r = await loadProfile(data.session.user);
    if (!r.account) return;
    if (r.disabled) return endSession(messageFor('account_disabled'));
    if (JSON.stringify(r.account) !== JSON.stringify(savedRef.current.account)) {
      persist({ mode: 'account', account: r.account });
    }
  }, [endSession, persist]);

  const loggedIn = saved?.mode === 'account';
  useEffect(() => {
    if (!loggedIn) return;
    Promise.resolve().then(refreshAccount); // check with the server in the background
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refreshAccount());
    return () => sub.remove();
  }, [loggedIn, refreshAccount]);

  const enterAccount = useCallback(
    async (user: User): Promise<AuthResult> => {
      const r = await loadProfile(user);
      const problem = !r.account ? r.error : r.disabled ? 'account_disabled' : r.tempExpired ? 'temp_expired' : null;
      if (problem !== null || !r.account) {
        await discardSession();
        return fail(problem ?? undefined);
      }
      // Guest data on this phone? Offer to merge it into the account (it then uploads with the next sync).
      try {
        await flushStore();
        const guest = await guestSummary();
        if (guest.hasData && (await askUpload(r.account.email, guest))) await moveGuestIntoAccount(r.account.userId);
      } catch (e) {
        console.warn('Failed to move guest data', e);
      }
      setNotice(null);
      persist({ mode: 'account', account: r.account });
      return { ok: true };
    },
    [discardSession, persist],
  );

  /** Log in with an email address, or with a username (looked up on the server so emails stay private). */
  const signIn = useCallback(
    async (identifier: string, password: string): Promise<AuthResult> => {
      const id = identifier.trim();
      if (id.includes('@')) {
        const { data, error } = await supabase.auth.signInWithPassword({ email: id, password });
        if (error) return fromAuthError(error);
        return enterAccount(data.user);
      }
      const username = normalizeUsername(id);
      if (!USERNAME_RE.test(username)) return fail('invalid_credentials');
      const r = await callFunction<{ access_token: string; refresh_token: string }>('login-username', { username, password });
      if (r.error === 'email_not_confirmed') {
        return { ok: false, code: 'email_not_confirmed_username', message: 'Log in with your email address once to confirm it.' };
      }
      if (r.error || !r.data) return fail(r.error);
      const { data, error } = await supabase.auth.setSession(r.data);
      if (error || !data.user) return error ? fromAuthError(error) : fail();
      return enterAccount(data.user);
    },
    [enterAccount],
  );

  const signUp = useCallback(
    async (p: { email: string; password: string; username: string; fullName: string }): Promise<AuthResult> => {
      const username = normalizeUsername(p.username);
      if (!USERNAME_RE.test(username)) return fail('invalid_username');
      const { data: free, error: rpcError } = await supabase.rpc('username_available', { p_username: username });
      if (rpcError) return fail('network');
      if (!free) return fail('username_taken');
      const { data, error } = await supabase.auth.signUp({
        email: p.email.trim(),
        password: p.password,
        options: { data: { username, full_name: p.fullName.trim(), privacy_version: PRIVACY_VERSION } },
      });
      if (error) {
        // The profile trigger rejects a username someone grabbed a moment ago.
        if (/database error saving new user/i.test(error.message)) return fail('username_taken');
        return fromAuthError(error);
      }
      // With email confirmation on, an email that's already registered comes back with no identities.
      if (data.user && data.user.identities?.length === 0) return fail('user_already_exists');
      if (data.session && data.user) return enterAccount(data.user);
      return { ok: true, needsCode: true };
    },
    [enterAccount],
  );

  const verifySignupCode = useCallback(
    async (email: string, code: string): Promise<AuthResult> => {
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'signup' });
      if (error) return fromAuthError(error);
      if (!data.user) return fail();
      return enterAccount(data.user);
    },
    [enterAccount],
  );

  const resendSignupCode = useCallback(async (email: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
    return error ? fromAuthError(error) : { ok: true };
  }, []);

  /** Always "succeeds" for unknown emails too, so nobody can probe which emails have accounts. */
  const sendResetCode = useCallback(async (email: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    return error ? fromAuthError(error) : { ok: true };
  }, []);

  /** The emailed code proves the rider owns the address, so the server lets them set a password without the old one. */
  const resetPasswordWithCode = useCallback(
    async (email: string, code: string, newPassword: string): Promise<AuthResult> => {
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'recovery' });
      if (error) return fromAuthError(error);
      if (!data.user) return fail();
      const r = await callFunction('change-password', { new_password: newPassword });
      if (r.error) {
        await discardSession();
        return fail(r.error);
      }
      return enterAccount(data.user);
    },
    [discardSession, enterAccount],
  );

  /** Change password with the current one. Also clears the "must change password" flag on the server. */
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<AuthResult> => {
      const r = await callFunction('change-password', { current_password: currentPassword, new_password: newPassword });
      if (r.error) return fail(r.error);
      const { data } = await supabase.auth.getUser();
      const p = data.user && (await loadProfile(data.user));
      const prev = savedRef.current?.account;
      if (p?.account) persist({ mode: 'account', account: p.account });
      else if (prev) persist({ mode: 'account', account: { ...prev, mustChangePassword: false } });
      return { ok: true };
    },
    [persist],
  );

  const recordConsent = useCallback(async (): Promise<AuthResult> => {
    const { error } = await supabase.rpc('record_privacy_consent', { p_version: PRIVACY_VERSION });
    if (error) return fail('network');
    const prev = savedRef.current?.account;
    if (prev) persist({ mode: 'account', account: { ...prev, needsConsent: false } });
    return { ok: true };
  }, [persist]);

  const updateUsername = useCallback(
    async (value: string): Promise<AuthResult> => {
      const prev = savedRef.current?.account;
      if (!prev) return fail();
      const username = normalizeUsername(value);
      if (!USERNAME_RE.test(username)) return fail('invalid_username');
      const { error } = await supabase.from('profiles').update({ username }).eq('id', prev.userId);
      if (error) return fail(error.code === '23505' ? 'username_taken' : /network|fetch/i.test(error.message) ? 'network' : undefined);
      persist({ mode: 'account', account: { ...prev, username } });
      return { ok: true };
    },
    [persist],
  );

  const continueAsGuest = useCallback(() => {
    setNotice(null);
    persist({ mode: 'guest' });
  }, [persist]);

  /**
   * Log out. 'keep': the account's records (and photos) become this phone's guest data.
   * 'remove': the account's copy and its photos are deleted from this phone. No choice: left as is (forced screen).
   */
  const signOut = useCallback(
    async (choice?: 'keep' | 'remove') => {
      const userId = savedRef.current?.account?.userId;
      if (userId && choice) {
        stopSync();
        await flushStore();
        try {
          if (choice === 'keep') await moveAccountToGuest(userId);
          else await clearAccountData(userId);
        } catch (e) {
          console.warn('Failed to move data on logout', e);
        }
      }
      await endSession(null);
    },
    [endSession],
  );

  /**
   * Permanently delete the account and everything stored online (the server checks the password again).
   * 'keep': this phone's copy of the records (and photos) becomes guest data. 'remove': it is deleted too.
   */
  const deleteAccount = useCallback(
    async (password: string, choice: 'keep' | 'remove'): Promise<AuthResult> => {
      const userId = savedRef.current?.account?.userId;
      if (!userId) return fail();
      // The server ends the session; don't show "You were logged out" while we tidy up.
      signingOut.current = true;
      const r = await callFunction('delete-account', { password });
      if (r.error) {
        signingOut.current = false;
        return fail(r.error);
      }
      stopSync();
      await flushStore();
      try {
        if (choice === 'keep') await moveAccountToGuest(userId);
        else await clearAccountData(userId);
      } catch (e) {
        console.warn('Failed to move data after deleting account', e);
      }
      await endSession('Your account was deleted.');
      return { ok: true };
    },
    [endSession],
  );

  const mode: AuthMode = saved ? saved.mode : 'loading';
  const account = saved?.mode === 'account' ? (saved.account ?? null) : null;

  return useMemo(
    () => ({
      mode,
      account,
      notice,
      /** AsyncStorage key for the data the app shows: guest data, or this account's copy on the phone. */
      storageKey: dataKeyFor(account?.userId),
      continueAsGuest,
      signIn,
      signUp,
      verifySignupCode,
      resendSignupCode,
      sendResetCode,
      resetPasswordWithCode,
      changePassword,
      recordConsent,
      updateUsername,
      refreshAccount,
      signOut,
      deleteAccount,
    }),
    [mode, account, notice, continueAsGuest, signIn, signUp, verifySignupCode, resendSignupCode, sendResetCode, resetPasswordWithCode, changePassword, recordConsent, updateUsername, refreshAccount, signOut, deleteAccount],
  );
}

type Auth = ReturnType<typeof useAuthValue>;
const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuthValue();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const a = useContext(AuthContext);
  if (!a) throw new Error('useAuth must be used inside AuthProvider');
  return a;
}
