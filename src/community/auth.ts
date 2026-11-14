import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { getSupabase, requireSupabase } from './supabase';

/** Must be listed in Supabase Auth → URL configuration (see supabase/README.md). */
const redirectTo = () => Linking.createURL('auth/callback');

/** Sign in with GitHub (OAuth, PKCE) through the system browser. */
export async function signInWithGitHub(): Promise<void> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: redirectTo(), skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('No OAuth URL returned');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo());
  if (result.type !== 'success') return; // user cancelled

  const { queryParams } = Linking.parse(result.url);
  const code = typeof queryParams?.code === 'string' ? queryParams.code : undefined;
  if (!code) throw new Error('OAuth callback did not include a code');
  const exchange = await supabase.auth.exchangeCodeForSession(code);
  if (exchange.error) throw exchange.error;
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}

export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return undefined;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

export function displayName(session: Session | null): string {
  const meta = session?.user.user_metadata as { user_name?: string; name?: string } | undefined;
  return meta?.user_name ?? meta?.name ?? session?.user.email ?? '';
}
