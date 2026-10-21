import { describe, expect, test } from 'vitest';
import type { AccountUsage } from '../model';
import {
  FORECAST_ALERT_MS,
  burnRate,
  forecastAccount,
  forecastScope,
  imminentHit,
  referenceLimit,
  weekDuty,
} from './forecast';
import { HOUR_MS, startOfWeek } from './periods';
import type { UsageBurn } from './types';

// Wednesday 15:00 local.
const NOW = new Date(2026, 9, 21, 15, 0).getTime();

function burn(over: Partial<UsageBurn> = {}): UsageBurn {
  return { tokens30m: 0, costUSD30m: 0, tokens60m: 0, costUSD60m: 0, activeHoursWeek: 20, ...over };
}

function usage(over: Partial<AccountUsage> = {}): AccountUsage {
  return {
    accountId: 'a',
    window5h: { tokens: 400_000, costUSD: 10, resetsAt: NOW + 2 * HOUR_MS },
    week: { tokens: 5_000_000, costUSD: 120, resetsAt: startOfWeek(NOW) + 7 * 24 * HOUR_MS },
    today: { tokens: 900_000, costUSD: 20 },
    burn: burn({ tokens30m: 100_000, costUSD30m: 3, tokens60m: 160_000, costUSD60m: 5 }),
    peaks: {
      window5h: { tokens: 1_000_000, costUSD: 25, samples: 8 },
      week: { tokens: 12_000_000, costUSD: 300, samples: 4 },
    },
    ...over,
  };
}

describe('burnRate', () => {
  test('averages the half hour pace and the hour pace', () => {
    // 100k in 30 min = 200k/h; 160k in 60 min = 160k/h.
    const rate = burnRate(burn({ tokens30m: 100_000, costUSD30m: 3, tokens60m: 160_000, costUSD60m: 5 }));
    expect(rate.tokensPerHour).toBe(180_000);
    expect(rate.costPerHour).toBe(5.5);
  });

  test('is zero when nothing was spent in the last half hour', () => {
    expect(burnRate(burn({ tokens60m: 500_000, costUSD60m: 9 }))).toEqual({ tokensPerHour: 0, costPerHour: 0 });
    expect(burnRate(undefined)).toEqual({ tokensPerHour: 0, costPerHour: 0 });
  });
});

describe('referenceLimit', () => {
  test('uses the configured limit first, in the configured unit', () => {
    expect(referenceLimit('window5h', usage(), { unit: 'tokens', window5h: 800_000 })).toEqual({
      value: 800_000,
      unit: 'tokens',
      source: 'configured',
    });
  });

  test('falls back to the highest completed block, in USD by default', () => {
    expect(referenceLimit('window5h', usage(), undefined)).toEqual({ value: 25, unit: 'usd', source: 'estimate' });
    expect(referenceLimit('week', usage(), { unit: 'tokens' })).toEqual({
      value: 12_000_000,
      unit: 'tokens',
      source: 'estimate',
    });
  });

  test('does not estimate from too little history', () => {
    const few = usage({
      peaks: { window5h: { tokens: 1, costUSD: 1, samples: 2 }, week: { tokens: 1, costUSD: 1, samples: 1 } },
    });
    expect(referenceLimit('window5h', few, undefined)).toBeUndefined();
  });

  test('ignores limits that are not positive numbers', () => {
    expect(referenceLimit('window5h', usage(), { unit: 'usd', window5h: 0 })?.source).toBe('estimate');
  });
});

describe('forecastScope for the 5 h window', () => {
  test('projects the usage at the end of the window at the current pace', () => {
    // 2 h left at $5.5/h on top of $10 used.
    const result = forecastScope('window5h', usage(), { unit: 'usd', window5h: 100 }, NOW);
    expect(result.projected).toBeCloseTo(21);
    expect(result.status).toBe('safe');
    expect(result.hitsAt).toBeUndefined();
  });

  test('predicts when the limit is crossed before the window ends', () => {
    // $15 left at $5.5/h = 2.727 h, which is after the reset in 2 h... so use a tighter limit: $14 -> 4 left = 0.727 h.
    const result = forecastScope('window5h', usage(), { unit: 'usd', window5h: 14 }, NOW);
    expect(result.status).toBe('will-hit');
    expect(result.hitsAt).toBeCloseTo(NOW + (4 / 5.5) * HOUR_MS, -2);
    expect(result.hitsAt as number).toBeLessThan(result.resetsAt);
  });

  test('is near when the projection ends between 80 % and 100 % of the limit', () => {
    const result = forecastScope('window5h', usage(), { unit: 'usd', window5h: 24 }, NOW);
    expect(result.projected).toBeCloseTo(21);
    expect(result.status).toBe('near');
  });

  test('is over when the limit is already reached', () => {
    expect(forecastScope('window5h', usage(), { unit: 'usd', window5h: 9 }, NOW).status).toBe('over');
  });

  test('is idle without recent activity and keeps what is used', () => {
    const result = forecastScope('window5h', usage({ burn: burn() }), { unit: 'usd', window5h: 100 }, NOW);
    expect(result.status).toBe('idle');
    expect(result.projected).toBe(10);
  });

  test('has no reference without a limit or history, but still projects', () => {
    const result = forecastScope('window5h', usage({ peaks: undefined }), undefined, NOW);
    expect(result.status).toBe('no-reference');
    expect(result.projected).toBeCloseTo(21);
    expect(result.limit).toBeUndefined();
  });

  test('works in tokens when that is the configured unit', () => {
    const result = forecastScope('window5h', usage(), { unit: 'tokens', window5h: 500_000 }, NOW);
    // 400k used, pace 180k/h, 100k left: crosses in 33 minutes.
    expect(result.unit).toBe('tokens');
    expect(result.status).toBe('will-hit');
    expect((result.hitsAt as number) - NOW).toBeCloseTo((100_000 / 180_000) * HOUR_MS, -2);
  });
});

describe('forecastScope for the week', () => {
  test('scales the pace by the share of hours the account is used', () => {
    // Wednesday 15:00 = 63 h into the week; 20 active hours -> duty 0.317.
    expect(weekDuty(burn({ activeHoursWeek: 20 }), NOW)).toBeCloseTo(20 / 63);
    const result = forecastScope('week', usage(), { unit: 'usd', week: 1000 }, NOW);
    expect(result.ratePerHour).toBeCloseTo(5.5 * (20 / 63), 5);
  });

  test('bounds the duty early in the week and for very light use', () => {
    const monday = startOfWeek(NOW) + 3 * HOUR_MS;
    expect(weekDuty(burn(), monday)).toBe(0.5);
    expect(weekDuty(burn({ activeHoursWeek: 0 }), NOW)).toBe(0.1);
    expect(weekDuty(burn({ activeHoursWeek: 500 }), NOW)).toBe(1);
  });
});

describe('imminentHit', () => {
  test('flags a hit closer than 30 minutes', () => {
    const forecast = forecastAccount(
      usage({ window5h: { tokens: 400_000, costUSD: 22, resetsAt: NOW + 2 * HOUR_MS } }),
      { unit: 'usd', window5h: 25 },
      NOW,
    );
    // $3 left at $5.5/h = 33 min: not yet.
    expect(imminentHit(forecast, NOW)).toBeUndefined();
    const closer = forecastAccount(
      usage({ window5h: { tokens: 400_000, costUSD: 23, resetsAt: NOW + 2 * HOUR_MS } }),
      { unit: 'usd', window5h: 25 },
      NOW,
    );
    expect(imminentHit(closer, NOW)?.scope).toBe('window5h');
    expect((imminentHit(closer, NOW)?.hitsAt as number) - NOW).toBeLessThan(FORECAST_ALERT_MS);
  });

  test('ignores accounts that are safe, idle or already over', () => {
    expect(imminentHit(forecastAccount(usage(), { unit: 'usd', window5h: 500, week: 5000 }, NOW), NOW)).toBeUndefined();
    expect(
      imminentHit(forecastAccount(usage({ burn: burn() }), { unit: 'usd', window5h: 12 }, NOW), NOW),
    ).toBeUndefined();
    expect(imminentHit(forecastAccount(usage(), { unit: 'usd', window5h: 5 }, NOW), NOW)).toBeUndefined();
  });
});
