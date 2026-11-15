/**
 * Lock-screen / now-playing artwork from the bundled episode thumbnails.
 *
 * The native now-playing loaders want a URL they can open themselves, and a
 * bundled picture is not one everywhere: in an Android release build it is a
 * drawable resource name. expo-asset copies it to a cache file once; after
 * that the file:// URI is known synchronously for the rest of the session.
 */
import { Asset } from 'expo-asset';
import { Platform } from 'react-native';
import type { Episode } from '@/content';
import { episodeThumb } from '@/content/thumbs';

/** Episode code -> URI the lock screen can load. */
const resolved = new Map<string, string>();

/** Relative URLs are fine for the web Media Session; native needs a real scheme. */
const loadable = (uri: string | null | undefined): uri is string =>
  !!uri && (Platform.OS === 'web' || /^(file|https?):/.test(uri));

/** The bundled artwork of `ep`, if it has one and it was already resolved. */
export const localArtworkUri = (ep: Episode): string | undefined => resolved.get(ep.code);

/**
 * Resolve the bundled artwork of `ep` to a loadable URI. Best-effort: undefined
 * when the episode has no bundled thumbnail or it cannot be read.
 */
export async function resolveLocalArtwork(ep: Episode): Promise<string | undefined> {
  const known = resolved.get(ep.code);
  if (known) return known;
  const thumb = episodeThumb(ep);
  if (thumb === undefined) return undefined;
  try {
    let asset = Asset.fromModule(thumb);
    if (!loadable(asset.localUri)) {
      // Android release: expo-asset marks a bundled image as "downloaded" with
      // its resource name as the URI. A plain descriptor makes it copy the file.
      if (asset.downloaded) {
        asset = new Asset({ name: asset.name, type: asset.type, hash: asset.hash, uri: asset.uri });
      }
      await asset.downloadAsync();
    }
    const uri = asset.localUri ?? asset.uri;
    if (!loadable(uri)) return undefined;
    resolved.set(ep.code, uri);
    return uri;
  } catch {
    return undefined;
  }
}
