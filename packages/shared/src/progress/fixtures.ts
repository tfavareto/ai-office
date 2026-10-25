// Builders for the tests of the progress (shared, server, web).
import { type DayFacts } from './types';

export function dayFacts(date: string, over: Partial<DayFacts> = {}): DayFacts {
  return {
    date,
    sessions: 1,
    activeMs: 3_600_000,
    tasks: 0,
    commits: 0,
    testsPassed: 0,
    tokens: 0,
    subagents: 0,
    peakAgents: 1,
    night: false,
    early: false,
    workers: [],
    ...over,
  };
}
