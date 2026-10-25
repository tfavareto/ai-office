import { afterEach, describe, expect, test, vi } from 'vitest';
import { dayFacts, emptyState, localDateKey, type DayFacts, type ProgressState } from '@ai-office/shared';
import { silentLogger } from '../log';
import { ProgressService, type DayReading, type ProgressDeps } from './service';

const NOW = new Date(2026, 9, 21, 15, 0).getTime();
const DAY_MS = 86_400_000;
const dateBack = (days: number): string => localDateKey(NOW - days * DAY_MS);

interface Setup {
  service: ProgressService;
  reads: string[];
  saves: ProgressState[];
  changes: () => number;
  unlocked: string[][];
}

function setup(
  readings: (date: string) => DayReading,
  initial: ProgressState = emptyState(),
  over: Partial<ProgressDeps> = {},
): Setup {
  const reads: string[] = [];
  const saves: ProgressState[] = [];
  const unlocked: string[][] = [];
  let changes = 0;
  const service = new ProgressService({
    now: () => NOW,
    log: silentLogger,
    store: {
      load: async () => initial,
      save: async (state) => {
        saves.push(state);
        return true;
      },
    },
    readDay: async (date) => {
      reads.push(date);
      return readings(date);
    },
    onChange: () => void changes++,
    onUnlock: (ids) => void unlocked.push([...ids]),
    backfillDays: 3,
    pauseMs: 0,
    ...over,
  });
  return { service, reads, saves, changes: () => changes, unlocked };
}

const work = (date: string, over: Partial<DayFacts> = {}): DayReading => ({
  facts: dayFacts(date, { tasks: 2, ...over }),
  complete: true,
});

afterEach(() => vi.useRealTimers());

describe('ProgressService', () => {
  test('the first run reads the days back to the backfill limit, then today', async () => {
    const { service, reads } = setup((date) => work(date));

    await service.start();
    await service.refresh();

    expect(reads).toEqual([dateBack(3), dateBack(2), dateBack(1), dateBack(0)]);
    expect(service.state.settledThrough).toBe(dateBack(1));
    expect(service.progress(false).stats.tasks).toBe(8);
    await service.stop();
  });

  test('a day that is over is read once: later runs only read what is new and today', async () => {
    const { service, reads } = setup((date) => work(date));
    await service.start();
    await service.refresh();
    reads.length = 0;

    await service.refresh();

    expect(reads).toEqual([dateBack(0)]);
    await service.stop();
  });

  test('today replaces its own earlier reading instead of adding to it', async () => {
    let tasks = 2;
    const { service } = setup((date) => work(date, { tasks }));
    await service.start();
    await service.refresh();
    const before = service.progress(false).stats.tasks;

    tasks = 5;
    await service.refresh();

    expect(service.progress(false).stats.tasks).toBe(before - 2 + 5);
    await service.stop();
  });

  test('resumes after a restart from the stored state without reading settled days again', async () => {
    const first = setup((date) => work(date));
    await first.service.start();
    await first.service.refresh();
    await first.service.stop();
    const stored = first.saves[first.saves.length - 1];

    const second = setup((date) => work(date), stored);
    await second.service.start();
    await second.service.refresh();

    expect(second.reads).toEqual([dateBack(0)]);
    expect(second.service.progress(false).stats.tasks).toBe(first.service.progress(false).stats.tasks);
    await second.service.stop();
  });

  test('an incomplete day is read again before it is settled, then accepted after a few tries', async () => {
    const { service, reads } = setup((date) => ({ ...work(date), complete: date !== dateBack(2) }), emptyState(), {
      backfillDays: 2,
    });
    await service.start();

    await service.refresh();
    expect(service.state.settledThrough).toBeUndefined();
    await service.refresh();
    await service.refresh();

    expect(reads.filter((date) => date === dateBack(2))).toHaveLength(3);
    expect(service.state.settledThrough).toBe(dateBack(1));
    await service.stop();
  });

  test('a day that cannot be read stops the run and leaves the days before it settled', async () => {
    const { service } = setup((date) => {
      if (date === dateBack(1)) throw new Error('disk');
      return work(date);
    });
    await service.start();

    await service.refresh();

    expect(service.state.settledThrough).toBe(dateBack(2));
    await service.stop();
  });

  test('announces the achievements a reading earns', async () => {
    const { service, unlocked } = setup((date) => work(date, { commits: 1, sessions: 1 }));
    await service.start();

    await service.refresh();

    expect(unlocked.flat()).toEqual(expect.arrayContaining(['firstSession', 'firstCommit']));
    await service.stop();
  });

  test('records a page-only event once', async () => {
    const { service } = setup(() => ({ complete: true }));
    await service.start();

    await service.recordEvent('timelapse');
    const first = service.state.events.timelapse;
    await service.recordEvent('timelapse');

    expect(first).toBe(NOW);
    expect(service.state.events.timelapse).toBe(first);
    expect(service.progress(false).achievements.find((a) => a.id === 'timelapse')?.unlockedAt).toBe(NOW);
    await service.stop();
  });

  test('keeps the highest number of agents seen at once', async () => {
    const { service } = setup(() => ({ complete: true }));
    await service.start();

    service.observeAgents(6);
    service.observeAgents(2);

    expect(service.state.records.peakAgents).toBe(6);
    expect(service.summary().recent.map((unlock) => unlock.id)).toContain('team5');
    await service.stop();
  });

  test('the summary follows the progress', async () => {
    const { service } = setup((date) => work(date, { tasks: 30, sessions: 8, activeMs: 6 * 3_600_000 }));
    await service.start();
    await service.refresh();

    expect(service.summary().level).toBeGreaterThan(1);
    await service.stop();
  });

  test('saves the state when it stops', async () => {
    const { service, saves } = setup((date) => work(date));
    await service.start();
    await service.refresh();
    saves.length = 0;

    await service.stop();

    expect(saves).toHaveLength(1);
    expect(saves[0]?.settledThrough).toBe(dateBack(1));
  });

  test('says the history is still being counted during the first run', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { service } = setup(() => ({ complete: true }), emptyState(), {
      readDay: async () => {
        await gate;
        return { complete: true };
      },
    });
    await service.start();

    expect(service.progress(false).counting).toBe(true);
    release();
    await service.refresh();

    expect(service.progress(false).counting).toBeUndefined();
    await service.stop();
  });
});
