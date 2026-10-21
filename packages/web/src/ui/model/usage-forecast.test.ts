import { afterEach, describe, expect, it } from 'vitest';
import { type AccountUsage, HOUR_MS, startOfWeek } from '@ai-office/shared';
import { setLocale, t } from '../../i18n';
import { describeForecast, formatAmount, forecastLines, imminentForAccount, takeFreshAlerts, usageAlerts } from './usage-forecast';

const NOW = new Date(2026, 9, 21, 15, 0).getTime();

function usage(over: Partial<AccountUsage> = {}): AccountUsage {
  return {
    accountId: 'a',
    window5h: { tokens: 400_000, costUSD: 22, resetsAt: NOW + 2 * HOUR_MS },
    week: { tokens: 5_000_000, costUSD: 120, resetsAt: startOfWeek(NOW) + 7 * 24 * HOUR_MS },
    today: { tokens: 900_000, costUSD: 30 },
    burn: { tokens30m: 100_000, costUSD30m: 3, tokens60m: 160_000, costUSD60m: 5, activeHoursWeek: 20 },
    peaks: { window5h: { tokens: 1_000_000, costUSD: 30, samples: 8 }, week: { tokens: 12_000_000, costUSD: 600, samples: 4 } },
    ...over,
  };
}

afterEach(() => setLocale('pt-BR'));

describe('describeForecast', () => {
  it('says where the pace leads and when the window ends', () => {
    const [window] = forecastLines(usage(), { unit: 'usd', window5h: 100 }, NOW);
    expect(window?.tone).toBe('ok');
    expect(window?.sentences).toHaveLength(1);
    expect(window?.sentences[0]).toMatchObject({ key: 'usage.forecast.window.pace', params: { time: '17:00' } });
    expect(t(window?.sentences[0]?.key ?? 'usage.forecast.window.pace', window?.sentences[0]?.params)).toContain('(fim da janela)');
  });

  it('adds the hit time when the limit is crossed before the window ends', () => {
    const [window] = forecastLines(usage(), { unit: 'usd', window5h: 25 }, NOW);
    expect(window?.tone).toBe('alert');
    expect(window?.sentences.map((s) => s.key)).toEqual(['usage.forecast.window.pace', 'usage.forecast.hit']);
    expect(window?.reference).toMatchObject({ key: 'usage.forecast.ref.configured' });
  });

  it('labels an estimated reference as such', () => {
    const [window] = forecastLines(usage(), undefined, NOW);
    expect(window?.reference).toMatchObject({ key: 'usage.forecast.ref.estimate' });
  });

  it('is calm without a reference and without activity', () => {
    const quiet = usage({ peaks: undefined, burn: { tokens30m: 0, costUSD30m: 0, tokens60m: 0, costUSD60m: 0, activeHoursWeek: 0 } });
    const [window] = forecastLines(quiet, undefined, NOW);
    expect(window?.tone).toBe('muted');
    expect(window?.sentences.map((s) => s.key)).toEqual(['usage.forecast.none']);
  });

  it('reports a limit already reached', () => {
    const [window] = forecastLines(usage(), { unit: 'usd', window5h: 10 }, NOW);
    expect(window?.sentences[0]?.key).toBe('usage.forecast.over.configured');
    const [estimated] = forecastLines(usage({ peaks: { window5h: { tokens: 1, costUSD: 5, samples: 5 }, week: { tokens: 1, costUSD: 5, samples: 5 } } }), undefined, NOW);
    expect(estimated?.sentences[0]?.key).toBe('usage.forecast.over.estimate');
  });

  it('formats amounts in the unit of the reference', () => {
    expect(formatAmount(12.4, 'usd')).toBe('US$ 12,40');
    expect(formatAmount(1_230_000, 'tokens')).toBe('1,23 mi tokens');
    setLocale('en');
    expect(formatAmount(12.4, 'usd')).toBe('$12.40');
  });

  it('renders every sentence in every language without leftovers', () => {
    const lines = [
      ...forecastLines(usage(), { unit: 'usd', window5h: 25, week: 100 }, NOW),
      ...forecastLines(usage({ burn: undefined }), { unit: 'tokens', window5h: 900_000 }, NOW),
      describeForecast(forecastLines(usage(), { unit: 'usd', window5h: 10 }, NOW)[0]!.forecast, NOW),
    ];
    for (const locale of ['pt-BR', 'en', 'es'] as const) {
      setLocale(locale);
      for (const line of lines) {
        for (const sentence of [...line.sentences, ...(line.reference ? [line.reference] : [])]) expect(t(sentence.key, sentence.params), `${locale} ${sentence.key}`).not.toMatch(/[{}]|^usage\./);
      }
    }
  });
});

describe('alerts', () => {
  it('finds accounts whose limit is closer than 30 minutes and ignores the others', () => {
    const near = usage({ window5h: { tokens: 400_000, costUSD: 23, resetsAt: NOW + 2 * HOUR_MS } });
    const far = usage({ accountId: 'b' });
    const alerts = usageAlerts([near, far], () => ({ unit: 'usd', window5h: 25 }), NOW);
    expect(alerts.map((alert) => alert.accountId)).toEqual(['a']);
    expect(imminentForAccount(far, { unit: 'usd', window5h: 500 }, NOW)).toBeUndefined();
  });

  it('notifies once per account and window, again for the next window', () => {
    const near = usage({ window5h: { tokens: 400_000, costUSD: 23, resetsAt: NOW + 2 * HOUR_MS } });
    const limits = () => ({ unit: 'usd' as const, window5h: 25 });
    const first = takeFreshAlerts(usageAlerts([near], limits, NOW), new Set());
    expect(first.fresh).toHaveLength(1);
    const again = takeFreshAlerts(usageAlerts([near], limits, NOW + 60_000), first.seen);
    expect(again.fresh).toHaveLength(0);
    const nextWindow = usage({ window5h: { tokens: 400_000, costUSD: 23, resetsAt: NOW + 9 * HOUR_MS } });
    expect(takeFreshAlerts(usageAlerts([nextWindow], limits, NOW), again.seen).fresh).toHaveLength(1);
  });
});
