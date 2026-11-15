import { resolveIncomingPath } from '@/lib/links';

/**
 * Every link that opens the app passes through here before expo-router matches
 * it: the custom scheme (shiryakhat://episode/<id>?t=) and the Universal / App
 * Links (https://shiryakhat.app/episode/<id>?t=) both land on `episode/[id]`.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return resolveIncomingPath(path);
  } catch {
    return path;
  }
}
