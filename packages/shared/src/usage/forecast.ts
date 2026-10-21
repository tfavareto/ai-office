// Limit forecast: projects the usage of the open 5 h window and of the week from the recent burn rate and compares it
// with a reference limit (configured by the user, or estimated from the highest completed block or week). Pure.
// Claude plan limits are not exposed on this computer, so every figure here is an estimate.
import type { AccountUsage } from '../model';
import { HOUR_MS, startOfWeek } from './periods';
import type { UsageBurn } from './types';

export type LimitUnit = 'usd' | 'tokens';
export type ForecastScope = 'window5h' | 'week';
export type LimitSource = 'configured' | 'estimate';

/** Limits an account owner typed in: per 5 h window and per week, in one unit. A missing value means "not set". */
export interface AccountLimits {
  unit: LimitUnit;
  window5h?: number;
  week?: number;
}

export type ForecastStatus =
  /** No configured limit and not enough history for an estimate. */
  | 'no-reference'
  /** Nothing was spent in the last half hour: the projection is what is already used. */
  | 'idle'
  | 'safe'
  /** The projection ends between 80 % and 100 % of the reference. */
  | 'near'
  /** The projection crosses the reference before the window ends. */
  | 'will-hit'
  /** The reference is already reached. */
  | 'over';

export interface Forecast {
  scope: ForecastScope;
  unit: LimitUnit;
  used: number;
  /** Usage at `resetsAt` if the current pace holds. */
  projected: number;
  resetsAt: number;
  /** Pace used for the projection, in `unit` per hour (for the week: the pace times the share of hours you work). */
  ratePerHour: number;
  limit?: number;
  source?: LimitSource;
  /** When the reference is crossed (only for `will-hit`). */
  hitsAt?: number;
  status: ForecastStatus;
}

export interface AccountForecast {
  window5h: Forecast;
  week: Forecast;
}

/** A projected hit closer than this raises the warning on the card and a notification. */
export const FORECAST_ALERT_MS = 30 * 60_000;
/** Completed blocks (or weeks) needed before the highest one is trusted as a reference. */
export const MIN_ESTIMATE_SAMPLES = 3;
/** Projection from this share of the reference upwards is "near". */
export const NEAR_RATIO = 0.8;
const MIN_WEEK_ELAPSED_HOURS = 12;
const DEFAULT_DUTY = 0.5;
const MIN_DUTY = 0.1;

export interface BurnRate {
  tokensPerHour: number;
  costPerHour: number;
}

const NO_BURN: BurnRate = { tokensPerHour: 0, costPerHour: 0 };

/**
 * Pace of the last hour, weighting the last half hour: the mean of the 30 minute pace and the 60 minute pace.
 * Nothing in the last half hour means idle.
 */
export function burnRate(burn: UsageBurn | undefined): BurnRate {
  if (burn === undefined || (burn.tokens30m <= 0 && burn.costUSD30m <= 0)) return NO_BURN;
  return {
    tokensPerHour: (burn.tokens30m * 2 + burn.tokens60m) / 2,
    costPerHour: (burn.costUSD30m * 2 + burn.costUSD60m) / 2,
  };
}

/** Share of the hours of this week (so far) in which the account was used, bounded: the week is not a 24/7 pace. */
export function weekDuty(burn: UsageBurn | undefined, now: number): number {
  const elapsedHours = (now - startOfWeek(now)) / HOUR_MS;
  if (burn === undefined || elapsedHours < MIN_WEEK_ELAPSED_HOURS) return DEFAULT_DUTY;
  return Math.min(1, Math.max(MIN_DUTY, burn.activeHoursWeek / elapsedHours));
}

function figure(unit: LimitUnit, value: { tokens: number; costUSD: number }): number {
  return unit === 'usd' ? value.costUSD : value.tokens;
}

function positive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

/** The limit a scope is compared with: the configured one, else the highest completed block or week. */
export function referenceLimit(scope: ForecastScope, usage: AccountUsage, limits: AccountLimits | undefined): { value: number; unit: LimitUnit; source: LimitSource } | undefined {
  const configured = limits?.[scope];
  if (limits !== undefined && positive(configured)) return { value: configured, unit: limits.unit, source: 'configured' };
  const peak = usage.peaks?.[scope];
  if (peak === undefined || peak.samples < MIN_ESTIMATE_SAMPLES) return undefined;
  const unit = limits?.unit ?? 'usd';
  const value = figure(unit, peak);
  return value > 0 ? { value, unit, source: 'estimate' } : undefined;
}

function statusOf(used: number, projected: number, rate: number, limit: number | undefined): ForecastStatus {
  if (limit === undefined) return 'no-reference';
  if (used >= limit) return 'over';
  if (rate <= 0) return 'idle';
  if (projected >= limit) return 'will-hit';
  return projected >= limit * NEAR_RATIO ? 'near' : 'safe';
}

/** Forecast of one scope (the open 5 h window or the week) at `now`. */
export function forecastScope(scope: ForecastScope, usage: AccountUsage, limits: AccountLimits | undefined, now: number): Forecast {
  const reference = referenceLimit(scope, usage, limits);
  const unit = reference?.unit ?? limits?.unit ?? 'usd';
  const window = scope === 'window5h' ? usage.window5h : usage.week;
  const burn = burnRate(usage.burn);
  const pace = unit === 'usd' ? burn.costPerHour : burn.tokensPerHour;
  const ratePerHour = scope === 'week' ? pace * weekDuty(usage.burn, now) : pace;
  const used = figure(unit, window);
  const remainingHours = Math.max(0, window.resetsAt - now) / HOUR_MS;
  const projected = used + ratePerHour * remainingHours;
  const status = statusOf(used, projected, ratePerHour, reference?.value);
  const hitsAt = status === 'will-hit' && reference !== undefined ? now + ((reference.value - used) / ratePerHour) * HOUR_MS : undefined;
  return {
    scope,
    unit,
    used,
    projected,
    resetsAt: window.resetsAt,
    ratePerHour,
    ...(reference !== undefined ? { limit: reference.value, source: reference.source } : {}),
    ...(hitsAt !== undefined ? { hitsAt } : {}),
    status,
  };
}

export function forecastAccount(usage: AccountUsage, limits: AccountLimits | undefined, now: number): AccountForecast {
  return { window5h: forecastScope('window5h', usage, limits, now), week: forecastScope('week', usage, limits, now) };
}

/** The forecast whose hit is soonest and closer than `FORECAST_ALERT_MS`, if any. */
export function imminentHit(forecast: AccountForecast, now: number): Forecast | undefined {
  const soon = [forecast.window5h, forecast.week].filter((item) => item.status === 'will-hit' && item.hitsAt !== undefined && item.hitsAt - now < FORECAST_ALERT_MS);
  return soon.sort((a, b) => (a.hitsAt as number) - (b.hitsAt as number))[0];
}

/** Share of the reference already used, 0..1 (more than 1 when over), or undefined without a reference. */
export function usedShare(forecast: Forecast): number | undefined {
  return forecast.limit === undefined ? undefined : forecast.used / forecast.limit;
}
