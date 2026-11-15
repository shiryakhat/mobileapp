import { Image, type ImageProps } from 'expo-image';
import { useState } from 'react';
import { forgetImage, useCachedImage } from '@/lib/cache';

interface Props extends Omit<ImageProps, 'source' | 'cachePolicy'> {
  uri: string;
}

/**
 * A remote picture that keeps working offline: shown from the disk cache when
 * it is there, fetched (and cached for next time) when it is not.
 */
export function CachedImage({ uri, onError, ...rest }: Props) {
  const cached = useCachedImage(uri);
  const [broken, setBroken] = useState<string>();
  // A cached file that no longer loads (purged by the OS) falls back to the network.
  const source = cached !== uri && broken === cached ? uri : cached;
  return (
    <Image
      {...rest}
      source={{ uri: source }}
      // Disk persistence is lib/cache's job; expo-image only keeps decoded bitmaps.
      cachePolicy="memory"
      onError={(event) => {
        if (source !== uri) {
          forgetImage(uri);
          setBroken(source);
        }
        onError?.(event);
      }}
    />
  );
}
