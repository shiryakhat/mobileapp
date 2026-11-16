import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useRef, useState, type ComponentRef } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { ShareCard } from '@/components/ShareCard';
import { Button, IconButton, Screen, Text } from '@/components/ui';
import { getEpisode } from '@/content';
import { useI18n } from '@/i18n';
import { formatTime } from '@/lib/format';
import { episodeWebLink, shareMessage } from '@/lib/links';
import { space } from '@/theme';
import NotFound from './+not-found';

/** Share an episode or a quote: as a rendered image card, or as text + links. */
export default function ShareScreen() {
  const params = useLocalSearchParams<{ id: string; t?: string; quote?: string }>();
  const { t, pick, locale } = useI18n();
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const [status, setStatus] = useState<string>();
  const episode = getEpisode(params.id);
  if (!episode) return <NotFound />;

  // The moment being shared (a quote's cue, or where the player was): every link carries it as ?t=.
  const seconds = Math.floor(Number(params.t));
  const timeSec = Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  const timeLabel = timeSec ? formatTime(timeSec, locale) : undefined;
  const quote = params.quote?.trim() || undefined;
  // The QR code and the main link: the universal link, which opens the app at that moment.
  const link = episodeWebLink(episode.id, timeSec);
  const message = shareMessage({
    ep: episode,
    title: pick(episode.titleFa, episode.titleEn),
    quote,
    timeSec,
    timeLabel,
    labels: { app: t('shareOpenInApp'), web: t('shareListenOnWeb') },
  });

  const shareImage = async () => {
    try {
      // On-device capture of the card view at 3x for a crisp 960px-wide PNG.
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png' });
      } else {
        await Share.share({ message, url: uri });
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : t('error'));
    }
  };

  return (
    <Screen edges={['top', 'bottom']} testID="share-screen">
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: space.sm }}>
        <Text variant="heading" style={{ flex: 1, paddingHorizontal: space.md }}>
          {t('shareCard')}
        </Text>
        <IconButton icon="x" label={t('close')} onPress={() => router.back()} />
      </View>
      <ScrollView
        contentContainerStyle={{ alignItems: 'center', padding: space.lg, gap: space.xl }}
      >
        <ShareCard
          ref={cardRef}
          episode={episode}
          quote={quote}
          timeLabel={timeLabel}
          link={link}
          locale={locale}
        />
        <View style={{ alignSelf: 'stretch', gap: space.sm }}>
          <Button
            testID="share-image"
            icon="image"
            label={t('shareImage')}
            onPress={() => void shareImage()}
          />
          <Button
            kind="secondary"
            icon="send"
            label={t('shareText')}
            onPress={() => void Share.share({ message }).catch(() => undefined)}
          />
          <Button
            kind="ghost"
            icon="copy"
            label={status ?? t('copyText')}
            onPress={() =>
              void Clipboard.setStringAsync(message).then(() => setStatus(t('copied')))
            }
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
