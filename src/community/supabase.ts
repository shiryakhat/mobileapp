import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import { communityEnabled, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/flags';

let client: SupabaseClient | undefined;

/** Lazily created client; `undefined` whenever the community flag is off. */
export function getSupabase(): SupabaseClient | undefined {
  if (!communityEnabled) return undefined;
  if (!client) {
    // Required lazily so builds with the flag off never initialise the SDK.
    const { createClient } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
  }
  return client;
}

export function requireSupabase(): SupabaseClient {
  const c = getSupabase();
  if (!c) throw new Error('Community features are disabled');
  return c;
}
