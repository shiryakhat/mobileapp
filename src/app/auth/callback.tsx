import { Redirect } from 'expo-router';

/**
 * Landing route for the OAuth redirect (shiryakhat://auth/callback).
 * The code exchange happens in community/auth.ts; this just returns home.
 */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
