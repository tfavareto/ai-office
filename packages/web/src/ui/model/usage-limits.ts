// The limits form of the usage dialog: reading what was typed and updating the saved limits without mutating them.
import type { AccountLimits, LimitUnit } from '@ai-office/shared';

/** Tokens are typed in millions. */
export const TOKEN_FIELD_SCALE = 1_000_000;
const MAX_FIELD_VALUE = 1e9;

export type LimitField = 'window5h' | 'week';

export type ParsedLimit = { kind: 'value'; value: number } | { kind: 'empty' } | { kind: 'invalid' };

/** A typed amount in the unit's field scale ("40", "12,5"): a positive number, nothing, or garbage. */
export function parseLimitInput(text: string, unit: LimitUnit): ParsedLimit {
  const clean = text.trim().replace(/\s+/g, '').replace(',', '.');
  if (clean === '') return { kind: 'empty' };
  if (!/^\d*\.?\d+$/.test(clean)) return { kind: 'invalid' };
  const typed = Number(clean);
  if (!Number.isFinite(typed) || typed <= 0 || typed > MAX_FIELD_VALUE) return { kind: 'invalid' };
  return { kind: 'value', value: unit === 'tokens' ? Math.round(typed * TOKEN_FIELD_SCALE) : typed };
}

/** The text a field shows for a stored limit. */
export function limitToInput(value: number | undefined, unit: LimitUnit): string {
  if (value === undefined) return '';
  const typed = unit === 'tokens' ? value / TOKEN_FIELD_SCALE : value;
  return String(Math.round(typed * 100) / 100);
}

type Limits = Readonly<Record<string, AccountLimits>>;

/** The saved limits with one field of one account changed; an account left with no value is dropped. */
export function withLimit(limits: Limits, accountId: string, field: LimitField, value: number | undefined): Limits {
  const current: AccountLimits = limits[accountId] ?? { unit: 'usd' };
  const next: AccountLimits = { unit: current.unit, ...(current.window5h !== undefined ? { window5h: current.window5h } : {}), ...(current.week !== undefined ? { week: current.week } : {}) };
  const updated = value === undefined ? omit(next, field) : { ...next, [field]: value };
  return store(limits, accountId, updated);
}

/** The saved limits with the unit of one account changed: its values are cleared, as they were in another unit. */
export function withUnit(limits: Limits, accountId: string, unit: LimitUnit): Limits {
  if ((limits[accountId]?.unit ?? 'usd') === unit) return limits;
  return store(limits, accountId, { unit });
}

export function withoutLimits(limits: Limits, accountId: string): Limits {
  return Object.fromEntries(Object.entries(limits).filter(([id]) => id !== accountId));
}

function omit(limits: AccountLimits, field: LimitField): AccountLimits {
  const other: LimitField = field === 'week' ? 'window5h' : 'week';
  const kept = limits[other];
  return { unit: limits.unit, ...(kept !== undefined ? { [other]: kept } : {}) };
}

function store(limits: Limits, accountId: string, next: AccountLimits): Limits {
  const hasValue = next.window5h !== undefined || next.week !== undefined;
  if (!hasValue && next.unit === 'usd') return withoutLimits(limits, accountId);
  return { ...limits, [accountId]: next };
}
