import { Image } from 'expo-image';
import type { Episode } from '@/content';
import { episodeThumb } from '@/content/thumbs';
import { radius, useTheme } from '@/theme';
import { CachedImage } from './CachedImage';

interface Props {
  episode: Episode;
  /** Edge of the square artwork. The 16:9 YouTube fallback is a third wider and proportionally lower. */
  size: number;
}

/**
 * Artwork of one episode: its bundled square thumbnail when there is one,
 * otherwise the (disk-cached) YouTube frame.
 */
export function EpisodeArtwork({ episode, size }: Props) {
  const theme = useTheme();
  const thumb = episodeThumb(episode);
  const style = { borderRadius: radius.md, backgroundColor: theme.raised };
  return thumb ? (
    <Image
      source={thumb}
      style={[style, { width: size, aspectRatio: 1 }]}
      contentFit="cover"
      testID="episode-artwork"
    />
  ) : (
    <CachedImage
      uri={episode.youtubeThumb}
      style={[style, { width: (size * 4) / 3, aspectRatio: 16 / 9 }]}
      contentFit="cover"
      testID="episode-artwork"
    />
  );
}
