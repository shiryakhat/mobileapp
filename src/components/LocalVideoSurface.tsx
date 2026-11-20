import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect } from 'react';
import { View } from 'react-native';
import { attachVideo, detachVideo, reportVideo } from '@/player/controller';

interface Props {
  /** file:// URI of the downloaded mp4 (see `localVideoUri`). */
  uri: string;
  width: number;
}

// expo-video is commanded by assigning to the player's properties. The player
// comes out of a hook, so the writes live here rather than in the component.
const seek = (player: VideoPlayer, sec: number) => {
  player.currentTime = sec;
};
const applyRate = (player: VideoPlayer, rate: number) => {
  player.playbackRate = rate;
};

/**
 * Local video engine: plays a downloaded mp4 with expo-video, offline.
 *
 * The counterpart of <YoutubeSurface/> for an episode that is on disk. The
 * controller commands the player through the handle (play / pause / seek /
 * rate) and the player reports its state back, so the transport, the scrubber
 * and the transcript follow it exactly as they follow the audio engine. The
 * native controls stay on (fullscreen, scrubbing); what the user does there is
 * reported like everything else.
 */
export function LocalVideoSurface({ uri, width }: Props) {
  const player = useVideoPlayer(uri, (p) => {
    p.timeUpdateEventInterval = 0.5;
  });

  useEffect(() => {
    // Until the file is ready, commands are remembered rather than sent: a seek
    // on a player without a loaded item is dropped, and playing first would
    // start from 0 for a moment before the resume position is applied.
    let ready = false;
    const handle = {
      play: () => {
        start.autoplay = true;
        if (ready) player.play();
      },
      pause: () => {
        start.autoplay = false;
        if (ready) player.pause();
      },
      seekTo: (sec: number) => {
        if (ready) seek(player, sec);
        else start.startAt = sec;
      },
      setRate: (rate: number) => {
        start.rate = rate;
        if (ready) applyRate(player, rate);
      },
    };
    const start = attachVideo(handle);

    const begin = () => {
      if (ready) return;
      ready = true;
      if (start.startAt) seek(player, start.startAt);
      applyRate(player, start.rate);
      if (player.duration > 0) reportVideo({ durationSec: player.duration });
      if (start.autoplay) player.play();
      else reportVideo({ playing: false, buffering: false });
    };

    const subscriptions = [
      player.addListener('statusChange', ({ status, error }) => {
        if (status === 'error') {
          reportVideo({ playing: false, buffering: false, error: error?.message ?? 'video' });
        } else if (status === 'readyToPlay') {
          if (!ready) begin();
          else reportVideo({ playing: player.playing, buffering: false, error: undefined });
        } else if (status === 'loading' && ready) {
          reportVideo({ buffering: true });
        }
      }),
      player.addListener('sourceLoad', ({ duration }) => {
        if (duration > 0) reportVideo({ durationSec: duration });
      }),
      player.addListener('playingChange', ({ isPlaying }) => {
        // Not playing because it is (re)loading is "buffering", not "paused".
        if (!ready || (!isPlaying && player.status === 'loading')) return;
        reportVideo({ playing: isPlaying, buffering: false });
      }),
      player.addListener('timeUpdate', ({ currentTime }) => {
        if (ready && Number.isFinite(currentTime)) reportVideo({ positionSec: currentTime });
      }),
      player.addListener('playToEnd', () => reportVideo({ playing: false, ended: true })),
    ];
    // A file that was already loaded by the time the listeners were attached.
    if (player.status === 'readyToPlay') begin();

    return () => {
      // The player itself is released by useVideoPlayer; by now it may be gone.
      for (const subscription of subscriptions) {
        try {
          subscription.remove();
        } catch {
          // already released
        }
      }
      detachVideo(handle);
    };
  }, [player]);

  const height = Math.round((width * 9) / 16);
  return (
    <View testID="local-video" style={{ width, height, backgroundColor: '#000' }}>
      <VideoView
        player={player}
        style={{ width, height }}
        contentFit="contain"
        nativeControls
        fullscreenOptions={{ enable: true }}
      />
    </View>
  );
}
