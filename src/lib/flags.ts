/**
 * Feature flags. Community features (auth, cloud bookmarks, minute comments,
 * questions) need a provisioned Supabase project, so they are OFF unless the
 * flag is set AND credentials are present. The app never blocks on the backend.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const communityEnabled =
  process.env.EXPO_PUBLIC_COMMUNITY_ENABLED === 'true' &&
  SUPABASE_URL.length > 0 &&
  SUPABASE_ANON_KEY.length > 0;
