/**
 * The coin-flip easter egg's page and the few words it exchanges with the app.
 * The page itself (COIN_PAGE) is the website's 3D coin, built into one offline
 * HTML document by scripts/build-coinflip.js from assets/coinflip/page.template.html.
 */
import { COIN_PAGE } from './coinPage.generated';

export type CoinFace = 'heads' | 'tails';

/** What the page reports: see the `tell(...)` calls in the template. */
export type CoinEvent =
  /** The page is up; `live` is false when it fell back to the still coin. */
  | { type: 'ready'; live: boolean }
  /** The coin came down on a face (also after tipping off its rim). */
  | { type: 'land'; face: CoinFace }
  /** The coin came down on its rim and is teetering. */
  | { type: 'edge' }
  /** The result is stale: the coin has gone back to turning. */
  | { type: 'idle' };

export interface CoinStageHandle {
  /** Toss the coin (or bat it again in mid-air). `x`: where the tap fell, from the left edge. */
  toss(x?: number): void;
}

export interface CoinStageProps {
  /** No animation: the coin is a still image that changes face (reduce motion). */
  still: boolean;
  onEvent: (event: CoinEvent) => void;
  ref?: React.Ref<CoinStageHandle>;
}

export function coinPageHtml(opts: { still: boolean }): string {
  return COIN_PAGE.replace('"__COIN_OPTS__"', () => JSON.stringify({ still: opts.still }));
}

/** Script that tosses the coin; a no-op until the page has set itself up. */
export function tossScript(x?: number): string {
  const arg = typeof x === 'number' && Number.isFinite(x) ? String(Math.round(x)) : '';
  return `window.__coin && window.__coin.toss(${arg}); true;`;
}

export function parseCoinEvent(data: unknown): CoinEvent | null {
  if (typeof data !== 'string') return null;
  try {
    const message: unknown = JSON.parse(data);
    if (typeof message !== 'object' || message === null) return null;
    const { type, face, live } = message as Record<string, unknown>;
    if (type === 'ready') return { type, live: live === true };
    if (type === 'land' && (face === 'heads' || face === 'tails')) return { type, face };
    if (type === 'edge' || type === 'idle') return { type };
  } catch {
    // not ours
  }
  return null;
}
