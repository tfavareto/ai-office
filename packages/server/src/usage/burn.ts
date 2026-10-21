// Recent consumption of an account, kept as small time-stamped samples so the page can project the limits.
import type { UsageBurn } from '@ai-office/shared';

export interface BurnSample {
  at: number;
  tokens: number;
  costUSD: number;
}

const MINUTE_MS = 60_000;
const HALF_HOUR_MS = 30 * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;
/** Samples older than this are dropped (a little more than the longest window the burn rate uses). */
export const SAMPLE_KEEP_MS = 65 * MINUTE_MS;

export function pruneSamples(samples: readonly BurnSample[], now: number): BurnSample[] {
  return samples.filter((sample) => sample.at >= now - SAMPLE_KEEP_MS);
}

function within(samples: readonly BurnSample[], from: number, to: number): { tokens: number; costUSD: number } {
  let tokens = 0;
  let costUSD = 0;
  for (const sample of samples) {
    if (sample.at < from || sample.at > to) continue;
    tokens += sample.tokens;
    costUSD += sample.costUSD;
  }
  return { tokens, costUSD };
}

/** What was spent in the last 30 and 60 minutes, plus how many hours of the week were active. */
export function burnOf(samples: readonly BurnSample[], now: number, activeHoursWeek: number): UsageBurn {
  const half = within(samples, now - HALF_HOUR_MS, now);
  const hour = within(samples, now - HOUR_MS, now);
  return {
    tokens30m: half.tokens,
    costUSD30m: half.costUSD,
    tokens60m: hour.tokens,
    costUSD60m: hour.costUSD,
    activeHoursWeek,
  };
}
