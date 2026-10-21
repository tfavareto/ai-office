// What the page says about the limit forecast: text keys and parameters per scope, the amber ring of a card and the
// notification that a limit is about to be reached. The math lives in @ai-office/shared; this is only presentation.
import { type AccountForecast, type AccountLimits, type AccountUsage, type Forecast, type ForecastScope, type LimitUnit, forecastAccount, imminentHit } from '@ai-office/shared';
import type { UiKey } from '../../i18n';
import { formatCost, formatMoment, formatTokens } from '../format';
import { t } from '../../i18n';

/** How many notified forecasts are remembered (one per account and window, so a few days of them). */
const MAX_REMEMBERED_ALERTS = 64;

export type ForecastTone = 'ok' | 'near' | 'alert' | 'muted';

export interface ForecastLine {
  scope: ForecastScope;
  forecast: Forecast;
  tone: ForecastTone;
  /** The sentences to show, in order. */
  sentences: { key: UiKey; params: Record<string, string | number> }[];
  /** Where the reference comes from, e.g. "Your limit: US$ 40", or undefined without reference. */
  reference: { key: UiKey; params: Record<string, string | number> } | undefined;
}

/** "US$ 12,40" or "1,2 mi tokens". */
export function formatAmount(value: number, unit: LimitUnit): string {
  return unit === 'usd' ? formatCost(value) : t('usage.amount.tokens', { n: formatTokens(value) });
}

const TONE: Record<Forecast['status'], ForecastTone> = { 'no-reference': 'muted', idle: 'ok', safe: 'ok', near: 'near', 'will-hit': 'alert', over: 'alert' };

function paceKey(scope: ForecastScope): UiKey {
  return scope === 'window5h' ? 'usage.forecast.window.pace' : 'usage.forecast.week.pace';
}

/** The sentences of one forecast. */
export function describeForecast(forecast: Forecast, now: number): ForecastLine {
  const { scope, unit, status } = forecast;
  const amount = formatAmount(forecast.projected, unit);
  const time = formatMoment(forecast.resetsAt, now);
  const sentences: ForecastLine['sentences'] = [];
  if (status === 'over') {
    const key = forecast.source === 'configured' ? 'usage.forecast.over.configured' : 'usage.forecast.over.estimate';
    sentences.push({ key, params: { used: formatAmount(forecast.used, unit), limit: formatAmount(forecast.limit ?? 0, unit) } });
  } else if (status === 'idle') {
    sentences.push({ key: scope === 'window5h' ? 'usage.forecast.idle.window5h' : 'usage.forecast.idle.week', params: { amount } });
  } else if (status === 'no-reference') {
    if (forecast.ratePerHour > 0) sentences.push({ key: paceKey(scope), params: { amount, time } });
    sentences.push({ key: 'usage.forecast.none', params: {} });
  } else {
    sentences.push({ key: paceKey(scope), params: { amount, time } });
    if (status === 'will-hit' && forecast.hitsAt !== undefined) sentences.push({ key: 'usage.forecast.hit', params: { time: formatMoment(forecast.hitsAt, now) } });
  }
  const reference =
    forecast.limit === undefined
      ? undefined
      : { key: forecast.source === 'configured' ? ('usage.forecast.ref.configured' as const) : ('usage.forecast.ref.estimate' as const), params: { limit: formatAmount(forecast.limit, unit) } };
  return { scope, forecast, tone: TONE[status], sentences, reference };
}

export function forecastLines(usage: AccountUsage, limits: AccountLimits | undefined, now: number): ForecastLine[] {
  const forecast = forecastAccount(usage, limits, now);
  return [describeForecast(forecast.window5h, now), describeForecast(forecast.week, now)];
}

// ---- the card warning and the notification ---------------------------------------------------------------------

export interface UsageAlert {
  /** Identifies this hit forecast once per window: it notifies once, not on every snapshot. */
  key: string;
  accountId: string;
  forecast: Forecast;
}

export function imminentForAccount(usage: AccountUsage, limits: AccountLimits | undefined, now: number): Forecast | undefined {
  const forecast: AccountForecast = forecastAccount(usage, limits, now);
  return imminentHit(forecast, now);
}

/** Accounts whose limit is about to be reached, with the soonest forecast of each. */
export function usageAlerts(usages: readonly AccountUsage[], limitsOf: (accountId: string) => AccountLimits | undefined, now: number): UsageAlert[] {
  const alerts: UsageAlert[] = [];
  for (const usage of usages) {
    const forecast = imminentForAccount(usage, limitsOf(usage.accountId), now);
    if (forecast !== undefined) alerts.push({ key: `${usage.accountId}:${forecast.scope}:${forecast.resetsAt}`, accountId: usage.accountId, forecast });
  }
  return alerts;
}

/** The alerts not notified yet, and the updated memory of what was notified. */
export function takeFreshAlerts(alerts: readonly UsageAlert[], seen: ReadonlySet<string>): { fresh: UsageAlert[]; seen: ReadonlySet<string> } {
  const fresh = alerts.filter((alert) => !seen.has(alert.key));
  return { fresh, seen: fresh.length === 0 ? seen : new Set([...seen, ...fresh.map((alert) => alert.key)].slice(-MAX_REMEMBERED_ALERTS)) };
}
