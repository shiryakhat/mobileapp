import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import YoutubePlayer, { type YoutubeIframeRef } from 'react-native-youtube-iframe';
import { attachYoutube, detachYoutube, reportYoutube } from '@/player/controller';
import { usePlayback } from '@/player/store';
import { YOUTUBE_BRIDGE_SCRIPT } from '@/player/youtubeBridge';

interface Props {
  videoId: string;
  width: number;
  /** Render collapsed: sound only (fallback for episodes with no public audio URL). */
  hidden?: boolean;
}

/**
 * The bridge goes in twice — at document start and again once the page has
 * loaded (it installs itself only once): whichever the platform's WebView
 * honours, the listeners are there before the player reports ready, which is
 * when the first command is sent.
 */
const WEB_VIEW_PROPS = {
  allowsInlineMediaPlayback: true,
  mediaPlaybackRequiresUserAction: false,
  injectedJavaScriptBeforeContentLoaded: YOUTUBE_BRIDGE_SCRIPT,
  injectedJavaScript: YOUTUBE_BRIDGE_SCRIPT,
};

/**
 * YouTube engine. Mirrors store state into the iframe and reports progress back.
 *
 * Play / pause is the `play` prop: the store's `playing`, which the transport
 * (`play` / `pause` / `toggle` in the controller) writes for every engine. The
 * library turns a change of that prop into a message to its player page; the
 * injected bridge is what makes the page act on it (see youtubeBridge.ts).
 */
export function YoutubeSurface({ videoId, width, hidden }: Props) {
  const ref = useRef<YoutubeIframeRef>(null);
  const startRef = useRef<number | undefined>(undefined);
  const playing = usePlayback((s) => s.playing);
  const rate = usePlayback((s) => s.rate);

  // The library only messages the iframe when its `play` prop changes. To send
  // a command again (the iframe did not follow the first one) the prop is
  // flipped for one commit and then handed back to the store.
  const [flip, setFlip] = useState<boolean>();

  const handle = useMemo(
    () => ({
      seekTo: (sec: number) => ref.current?.seekTo(sec, true),
      resend: (want: boolean) => setFlip(!want),
    }),
    [],
  );

  useEffect(() => {
    if (flip === undefined) return;
    // By now the flipped prop has been committed (and so sent): hand it back.
    const timer = setTimeout(() => setFlip(undefined), 0);
    return () => clearTimeout(timer);
  }, [flip]);

  useEffect(() => {
    startRef.current = attachYoutube(handle);
    const timer = setInterval(() => {
      ref.current
        ?.getCurrentTime()
        .then((positionSec) => {
          if (Number.isFinite(positionSec) && positionSec > 0) reportYoutube({ positionSec });
        })
        .catch(() => undefined);
    }, 500);
    return () => {
      clearInterval(timer);
      detachYoutube(handle);
    };
  }, [handle]);

  const onReady = useCallback(() => {
    if (startRef.current) ref.current?.seekTo(startRef.current, true);
    startRef.current = undefined;
    ref.current
      ?.getDuration()
      .then((durationSec) => {
        if (durationSec > 0) reportYoutube({ durationSec });
      })
      .catch(() => undefined);
  }, []);

  const onChangeState = useCallback((state: string) => {
    if (state === 'playing') reportYoutube({ playing: true, buffering: false });
    else if (state === 'paused') reportYoutube({ playing: false, buffering: false });
    else if (state === 'buffering') reportYoutube({ buffering: true });
    else if (state === 'ended') reportYoutube({ playing: false, ended: true });
  }, []);

  const height = Math.round((width * 9) / 16);
  return (
    <View
      style={
        hidden
          ? { height: 1, width: 1, opacity: 0.01, overflow: 'hidden' }
          : { width, height, backgroundColor: '#000' }
      }
      pointerEvents={hidden ? 'none' : 'auto'}
    >
      <YoutubePlayer
        ref={ref}
        height={height}
        width={width}
        videoId={videoId}
        play={flip ?? playing}
        playbackRate={rate}
        onReady={onReady}
        onChangeState={onChangeState}
        initialPlayerParams={{ modestbranding: true, rel: false, preventFullScreen: false }}
        webViewProps={WEB_VIEW_PROPS}
      />
    </View>
  );
}
