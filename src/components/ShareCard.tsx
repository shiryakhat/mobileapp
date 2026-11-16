import type { ComponentRef, Ref } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { Episode } from '@/content';
import { translate } from '@/i18n';
import { joinMeta } from '@/lib/format';
import { hasPersian } from '@/lib/text';
import { dark, font, radius, space } from '@/theme';
import { CachedImage } from './CachedImage';
import { Text } from './ui';

interface Props {
  episode: Episode;
  quote?: string;
  timeLabel?: string;
  /** What the QR code opens: the universal link (the app, at `timeLabel`'s moment). */
  link: string;
  locale: 'fa' | 'en';
  ref?: Ref<ComponentRef<typeof View>>;
}

export const SHARE_CARD_WIDTH = 320;

/**
 * The shareable image. Always rendered in the dark palette and at a fixed
 * width so the captured PNG looks identical on every device and theme.
 */
export function ShareCard({ episode, quote, timeLabel, link, locale, ref }: Props) {
  const c = dark;
  const rtl = locale === 'fa';
  const title = rtl ? episode.titleFa || episode.titleEn : episode.titleEn || episode.titleFa;
  const quoteRTL = quote ? hasPersian(quote) : rtl;
  return (
    <View
      ref={ref}
      collapsable={false}
      style={{
        width: SHARE_CARD_WIDTH,
        direction: rtl ? 'rtl' : 'ltr',
        backgroundColor: c.bg,
        borderRadius: radius.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: c.line,
      }}
    >
      <CachedImage
        uri={episode.youtubeThumb}
        style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: c.raised }}
        contentFit="cover"
      />
      <View style={{ padding: space.xl, gap: space.lg }}>
        {quote ? (
          <View style={{ gap: space.sm }}>
            <View style={{ width: 28, height: 3, borderRadius: 2, backgroundColor: c.accent }} />
            <Text
              dir={quoteRTL ? 'rtl' : 'ltr'}
              align={quoteRTL === rtl ? 'start' : 'end'}
              numberOfLines={9}
              style={{ color: c.text, fontFamily: font.medium, fontSize: 17, lineHeight: 30 }}
            >
              {quote}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.lg }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="small" weight="medium" numberOfLines={3} style={{ color: c.text }}>
              {title}
            </Text>
            <Text variant="micro" style={{ color: c.accent }}>
              {joinMeta(episode.code, timeLabel)}
            </Text>
            <Text variant="micro" style={{ color: c.muted, marginTop: space.sm }}>
              {translate(locale, 'appName')} · shiryakhat.app
            </Text>
          </View>
          <View
            accessibilityLabel={translate(locale, 'scanToListen')}
            style={{ padding: 6, borderRadius: radius.sm, backgroundColor: c.text }}
          >
            <QRCode value={link} size={64} backgroundColor={c.text} color={c.bg} />
          </View>
        </View>
      </View>
    </View>
  );
}
