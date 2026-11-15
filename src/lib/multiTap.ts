/**
 * Counts a quick run of taps (the version-number easter egg in Settings).
 * `tap(now)` returns true on the tap that completes the run. The run starts
 * over when two taps are too far apart, or when it takes too long overall.
 */
export function createMultiTap({ count = 4, windowMs = 1200, gapMs = 600 } = {}) {
  let first = 0;
  let last = 0;
  let taps = 0;
  return function tap(now: number = Date.now()): boolean {
    if (taps === 0 || now - last > gapMs || now - first > windowMs) {
      first = now;
      taps = 0;
    }
    last = now;
    taps += 1;
    if (taps < count) return false;
    taps = 0;
    return true;
  };
}
