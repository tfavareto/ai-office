// Believable usage history for demo mode: ten weeks of hourly rows for the two demo accounts with a working-day
// pattern, several projects, models and sessions. Deterministic: the same hour always yields the same numbers.
import { type Account } from '../model';
import { fnv1a, mulberry32 } from '../hash';
import { DAY_MS, HOUR_MS, addDays, floorToHour, startOfDay } from '../usage/periods';
import { tokensCostUSD } from '../usage/pricing';
import { type UsageRow, rowTokens } from '../usage/types';
import { type HourMap, activeHoursInWeek, computeAccountUsage, computePeaks } from '../usage/windows';
import type { AccountUsage } from '../model';
import { hourMapsFromRows } from '../usage/aggregate';
import { DEMO_ACCOUNTS, DEMO_PROJECTS } from './content';

/** A session of the demo office; today's history is attributed to them so the usage tables link to real people. */
export interface DemoSessionAnchor {
  account: string;
  session: string;
  project: string;
}

const HISTORY_DAYS = 70;
/** The numbers move once a minute, so the demo does not republish the snapshot on every tick. */
const QUANTUM_MS = 60_000;
/** The office is working right now: the latest hours are active whatever the time of day. */
const FORCED_ACTIVE_HOURS = 4;
const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-4-5';

interface Profile {
  /** Billable tokens of a full-intensity hour. */
  scale: number;
  weekday: number;
  weekend: number;
  evening: number;
}

const PROFILES: Readonly<Record<string, Profile>> = {
  'demo-pessoal': { scale: 230_000, weekday: 0.8, weekend: 0.4, evening: 1.5 },
  'demo-trabalho': { scale: 360_000, weekday: 1, weekend: 0.06, evening: 0.3 },
};

/** Intensity of a local hour of the day on a working day (0..1). */
function dayCurve(hour: number, evening: number): number {
  if (hour < 7) return 0;
  if (hour === 7) return 0.2;
  if (hour === 8) return 0.6;
  if (hour <= 11) return 1;
  if (hour <= 13) return 0.5;
  if (hour <= 17) return 0.95;
  if (hour === 18) return 0.6;
  if (hour <= 21) return 0.35 * evening;
  if (hour === 22) return 0.15 * evening;
  return 0.04;
}

interface Slot {
  session: string;
  project: string;
  model: string;
  weight: number;
}

function projectPath(index: number): string {
  return (DEMO_PROJECTS[index % DEMO_PROJECTS.length] as { path: string }).path;
}

/** The sessions working during a given hour: the first is the main one, the others come and go. */
function slotsFor(account: string, accountIndex: number, hour: number, dayStart: number, anchors: readonly DemoSessionAnchor[], rng: () => number): Slot[] {
  const dayIndex = Math.round(dayStart / DAY_MS);
  const count = 1 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.15 ? 1 : 0);
  const models = [OPUS, SONNET, SONNET];
  const slots: Slot[] = [];
  for (let k = 0; k < count; k++) {
    const anchor = anchors.length > 0 ? anchors[(k + Math.floor(hour / HOUR_MS)) % anchors.length] : undefined;
    slots.push({
      session: anchor?.session ?? fnv1a(`${account}:${dayIndex}:${k}`).toString(16).padStart(8, '0'),
      project: anchor?.project ?? projectPath(dayIndex + k + accountIndex * 3),
      model: models[k] as string,
      weight: k === 0 ? 1 : 0.35 + rng() * 0.3,
    });
  }
  return slots;
}

function makeRow(hour: number, account: string, slot: Slot, agent: string, model: string, billable: number, rng: () => number): UsageRow {
  const input = Math.round(billable * 0.03);
  const output = Math.round(billable * 0.22);
  const cacheWrite = Math.round(billable * 0.75);
  const cacheRead = Math.round(billable * 14 * (0.8 + rng() * 0.4));
  const costUSD = tokensCostUSD(model, { input, output, cacheWrite5m: Math.round(cacheWrite * 0.85), cacheWrite1h: Math.round(cacheWrite * 0.15), cacheRead }) ?? 0;
  return { hour, account, project: slot.project, model, session: slot.session, agent, input, output, cacheWrite, cacheRead, costUSD };
}

function hourRows(account: string, accountIndex: number, hour: number, now: number, anchors: readonly DemoSessionAnchor[]): UsageRow[] {
  const profile = PROFILES[account] ?? (PROFILES['demo-pessoal'] as Profile);
  const rng = mulberry32(fnv1a(`${account}:${hour}`));
  const local = new Date(hour);
  const weekend = local.getDay() === 0 || local.getDay() === 6;
  const dayStart = startOfDay(hour);
  const dayMood = 0.55 + mulberry32(fnv1a(`${account}:day:${dayStart}`))() * 0.85;
  const forced = hour > floorToHour(now) - FORCED_ACTIVE_HOURS * HOUR_MS;
  let intensity = dayCurve(local.getHours(), profile.evening) * (weekend ? profile.weekend : profile.weekday) * dayMood * (0.5 + rng());
  if (forced) intensity = Math.max(intensity, 0.7 + rng() * 0.4);
  if (intensity < 0.05 || (!forced && rng() < 0.1)) return [];
  const elapsed = hour === floorToHour(now) ? Math.max(0.05, (now - hour) / HOUR_MS) : 1;
  const billable = profile.scale * intensity * elapsed;
  const slots = slotsFor(account, accountIndex, hour, dayStart, anchors, rng);
  const total = slots.reduce((sum, slot) => sum + slot.weight, 0);
  const rows: UsageRow[] = [];
  slots.forEach((slot, index) => {
    const share = (billable * slot.weight) / total;
    const sub = index === 0 && rng() < 0.55 ? 0.14 : 0;
    rows.push(makeRow(hour, account, slot, '', slot.model, share * (1 - sub), rng));
    if (sub > 0) rows.push(makeRow(hour, account, slot, `ag${Math.floor(hour / HOUR_MS) % 7}`, rng() < 0.6 ? HAIKU : SONNET, share * sub, rng));
  });
  return rows;
}

const quantize = (at: number): number => Math.floor(at / QUANTUM_MS) * QUANTUM_MS;

const historyCache = new Map<number, UsageRow[]>();

/** Rows of the days before today, which never change: computed once per local day. */
function pastRows(todayStart: number, now: number): UsageRow[] {
  const cached = historyCache.get(todayStart);
  if (cached !== undefined) return cached;
  historyCache.clear();
  const rows: UsageRow[] = [];
  const from = addDays(todayStart, -HISTORY_DAYS);
  DEMO_ACCOUNTS.forEach((account, index) => {
    for (let hour = from; hour < todayStart; hour += HOUR_MS) rows.push(...hourRows(account.id, index, hour, now, []));
  });
  historyCache.set(todayStart, rows);
  return rows;
}

/** Ten weeks of hourly usage for the demo accounts up to `now`; today's sessions are the `anchors`. */
export function demoUsageRows(at: number, anchors: readonly DemoSessionAnchor[] = []): UsageRow[] {
  const now = quantize(at);
  const todayStart = startOfDay(now);
  const rows = [...pastRows(todayStart, now)];
  const end = floorToHour(now);
  DEMO_ACCOUNTS.forEach((account, index) => {
    const mine = anchors.filter((anchor) => anchor.account === account.id);
    for (let hour = Math.ceil(todayStart / HOUR_MS) * HOUR_MS; hour <= end; hour += HOUR_MS) rows.push(...hourRows(account.id, index, hour, now, mine));
  });
  return rows;
}

/** Hourly totals per demo account. */
export function demoHourMaps(rows: readonly UsageRow[]): Map<string, HourMap> {
  return hourMapsFromRows(rows);
}

/** Burn rate of a demo account: the current hour's full pace, as if it had been steady for the last hour. */
function demoBurn(rows: readonly UsageRow[], account: string, now: number, hours: HourMap): AccountUsage['burn'] {
  const current = floorToHour(now);
  const elapsed = Math.max(0.05, (now - current) / HOUR_MS);
  const sum = (hour: number): { tokens: number; costUSD: number } => {
    let tokens = 0;
    let costUSD = 0;
    for (const row of rows) {
      if (row.account !== account || row.hour !== hour) continue;
      tokens += rowTokens(row);
      costUSD += row.costUSD;
    }
    return { tokens, costUSD };
  };
  const now1 = sum(current);
  const before = sum(current - HOUR_MS);
  const pace = { tokens: now1.tokens / elapsed, costUSD: now1.costUSD / elapsed };
  return {
    tokens30m: pace.tokens * 0.5,
    costUSD30m: pace.costUSD * 0.5,
    tokens60m: pace.tokens * 0.5 + before.tokens * 0.5,
    costUSD60m: pace.costUSD * 0.5 + before.costUSD * 0.5,
    activeHoursWeek: activeHoursInWeek(hours, now),
  };
}

/** Usage cards of the demo accounts, derived from the same history the detail view shows. */
export function demoAccountUsage(at: number, rows: readonly UsageRow[], accounts: readonly Account[] = DEMO_ACCOUNTS): AccountUsage[] {
  const now = quantize(at);
  const maps = demoHourMaps(rows);
  return accounts.map((account) => {
    const hours = maps.get(account.id) ?? new Map();
    return computeAccountUsage(account.id, hours, now, { burn: demoBurn(rows, account.id, now, hours), peaks: computePeaks(hours, now) });
  });
}
