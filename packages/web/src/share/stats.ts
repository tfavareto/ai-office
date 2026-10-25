// Which headline numbers the card shows (pure): the day's totals in, a short ordered list out.
import type { ReportTotals } from '@ai-office/shared';
import type { StatId, StatTone } from './types';

export interface StatSpec {
  id: StatId;
  /** Raw number: milliseconds for `time`, tokens for `tokens`, US dollars for `cost`, a count otherwise. */
  value: number;
  tone: StatTone;
}

const TONES: Readonly<Record<StatId, StatTone>> = {
  agents: 'blue',
  time: 'green',
  tasks: 'amber',
  commits: 'violet',
  tests: 'cyan',
  files: 'cyan',
  tokens: 'blue',
  cost: 'amber',
};

/** Fewer tiles than this look empty: a quiet day gets the files count as filler. */
export const MIN_STATS = 3;

export interface StatChoice {
  showUsage: boolean;
}

/**
 * Agents and active time always lead; tasks done, commits and passed tests follow when the day had any. Tokens and
 * estimated cost come last and only when `showUsage` is on (they are off by default) and something was spent.
 */
export function selectStats(totals: ReportTotals, choice: StatChoice): StatSpec[] {
  const counted: [StatId, number][] = [
    ['tasks', totals.tasks],
    ['commits', totals.commits],
    ['tests', totals.testsPassed],
  ];
  const specs: StatSpec[] = [
    { id: 'agents', value: totals.agents, tone: TONES.agents },
    { id: 'time', value: totals.activeMs, tone: TONES.time },
    ...counted.filter(([, value]) => value > 0).map(([id, value]) => ({ id, value, tone: TONES[id] })),
  ];
  if (specs.length < MIN_STATS && totals.files > 0) specs.push({ id: 'files', value: totals.files, tone: TONES.files });
  if (choice.showUsage && totals.tokens > 0) {
    specs.push({ id: 'tokens', value: totals.tokens, tone: TONES.tokens });
    specs.push({ id: 'cost', value: totals.costUSD, tone: TONES.cost });
  }
  return specs;
}
