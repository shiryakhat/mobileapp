/** The web build of ./CoinStage.tsx: the same page, in an <iframe>. */
import { useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { coinPageHtml, parseCoinEvent, type CoinStageHandle, type CoinStageProps } from './page';

type CoinWindow = Window & { __coin?: CoinStageHandle };

export function CoinStage({ still, onEvent, ref }: CoinStageProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => coinPageHtml({ still }), [still]);

  useImperativeHandle(
    ref,
    () => ({
      // A srcdoc frame shares this page's origin, so the coin can be called directly.
      toss: (x) => (frame.current?.contentWindow as CoinWindow | null)?.__coin?.toss(x),
    }),
    [],
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const event = parseCoinEvent(e.data);
      if (event) onEvent(event);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onEvent]);

  return (
    <iframe
      ref={frame}
      srcDoc={html}
      title="coin"
      tabIndex={-1}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
