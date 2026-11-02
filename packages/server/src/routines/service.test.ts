import { describe, expect, test } from 'vitest';
import {
  MAX_ROUTINES,
  MIN_INTERVAL_MINUTES,
  RoutineService,
  nextRunAt,
  parseRoutineInput,
  type RoutineDeps,
  type RoutineInput,
} from './service';

const MINUTE = 60_000;
const input: RoutineInput = {
  name: 'Tests',
  prompt: 'Run the tests',
  projectPath: '/w/p',
  schedule: { kind: 'interval', minutes: 10 },
};

function setup(overrides: Partial<RoutineDeps> = {}) {
  let clock = 1_000_000;
  const pasted: { id: string; text: string }[] = [];
  const started: { path: string; prompt: string }[] = [];
  const deps: RoutineDeps = {
    now: () => clock,
    newId: () => `r${pasted.length + started.length + clock}`,
    enabled: () => true,
    terminalsIn: () => [],
    paste: (id, text) => {
      pasted.push({ id, text });
      return true;
    },
    start: (path, prompt) => {
      started.push({ path, prompt });
      return Promise.resolve();
    },
    onChange: () => undefined,
    ...overrides,
  };
  return { service: new RoutineService(deps), pasted, started, advance: (ms: number) => (clock += ms) };
}

describe('nextRunAt', () => {
  test('an interval counts from now', () => {
    expect(nextRunAt({ kind: 'interval', minutes: 10 }, 1000)).toBe(1000 + 10 * MINUTE);
  });

  test('a daily time is today if it is still ahead, else tomorrow', () => {
    // Arrange
    const morning = new Date(2026, 5, 10, 8, 0).getTime();
    const evening = new Date(2026, 5, 10, 20, 0).getTime();
    const schedule = { kind: 'daily', hour: 9, minute: 30 } as const;

    // Act and assert
    expect(nextRunAt(schedule, morning)).toBe(new Date(2026, 5, 10, 9, 30).getTime());
    expect(nextRunAt(schedule, evening)).toBe(new Date(2026, 5, 11, 9, 30).getTime());
  });
});

describe('parseRoutineInput', () => {
  test('accepts a valid routine', () => {
    expect(parseRoutineInput({ ...input })).toEqual(input);
  });

  test('refuses what would run too often or has nothing to do', () => {
    expect(
      parseRoutineInput({ ...input, schedule: { kind: 'interval', minutes: MIN_INTERVAL_MINUTES - 1 } }),
    ).toBeNull();
    expect(parseRoutineInput({ ...input, schedule: { kind: 'daily', hour: 24, minute: 0 } })).toBeNull();
    expect(parseRoutineInput({ ...input, schedule: { kind: 'cron' } })).toBeNull();
    expect(parseRoutineInput({ ...input, prompt: '  ' })).toBeNull();
    expect(parseRoutineInput({ ...input, name: '' })).toBeNull();
    expect(parseRoutineInput({ ...input, prompt: 'x'.repeat(8001) })).toBeNull();
    expect(parseRoutineInput({ ...input, projectPath: 'relative' })).toBeNull();
    expect(parseRoutineInput('nope')).toBeNull();
  });
});

describe('RoutineService', () => {
  test('does nothing before its time', async () => {
    // Arrange
    const { service, started } = setup();
    service.add(input);

    // Act
    await service.tick();

    // Assert
    expect(started).toEqual([]);
  });

  test('with no terminal in the project, starts one with the prompt', async () => {
    // Arrange
    const { service, started, advance } = setup();
    const routine = service.add(input);
    advance(10 * MINUTE);

    // Act
    await service.tick();

    // Assert
    expect(started).toEqual([{ path: '/w/p', prompt: 'Run the tests' }]);
    expect(service.list()[0]?.history[0]).toMatchObject({ outcome: 'started' });
    expect(service.list()[0]?.nextRunAt).toBeGreaterThan(routine.nextRunAt);
  });

  test('with an idle terminal in the project, types the prompt there', async () => {
    // Arrange
    const { service, pasted, started, advance } = setup({
      terminalsIn: () => [{ id: 't1', busy: false }],
    });
    service.add(input);
    advance(10 * MINUTE);

    // Act
    await service.tick();

    // Assert
    expect(pasted).toEqual([{ id: 't1', text: 'Run the tests' }]);
    expect(started).toEqual([]);
    expect(service.list()[0]?.history[0]).toMatchObject({ outcome: 'sent' });
  });

  test('skips a turn while the agent is busy, and tries at the next one', async () => {
    // Arrange
    const { service, pasted, started, advance } = setup({
      terminalsIn: () => [{ id: 't1', busy: true }],
    });
    service.add(input);
    advance(10 * MINUTE);

    // Act
    await service.tick();

    // Assert
    expect(pasted).toEqual([]);
    expect(started).toEqual([]);
    expect(service.list()[0]?.history[0]).toMatchObject({ outcome: 'skipped-busy' });
  });

  test('while the agent is busy it tries again in five minutes, even if its turn is tomorrow', async () => {
    // Arrange
    const { service, advance } = setup({ terminalsIn: () => [{ id: 't1', busy: true }] });
    const { id } = service.add({ ...input, schedule: { kind: 'daily', hour: 9, minute: 0 } });
    advance(25 * 60 * MINUTE);

    // Act
    await service.tick();
    const retryAt = service.list().find((routine) => routine.id === id)?.nextRunAt ?? 0;

    // Assert
    expect(retryAt - (1_000_000 + 25 * 60 * MINUTE)).toBeLessThanOrEqual(5 * MINUTE);
  });

  test('two routines due together never share a terminal: the second waits', async () => {
    // Arrange
    const taken = new Set<string>();
    const { service, pasted, advance } = setup({
      newId: () => `r${taken.size}${Math.random()}`,
      terminalsIn: () => [{ id: 't1', busy: taken.has('t1') }],
      paste: (id, text) => {
        taken.add(id);
        pasted.push({ id, text });
        return true;
      },
    });
    service.add(input);
    service.add({ ...input, prompt: 'Other' });
    advance(10 * MINUTE);

    // Act
    await service.tick();

    // Assert
    expect(pasted).toEqual([{ id: 't1', text: 'Run the tests' }]);
    expect(service.list().map((routine) => routine.history[0]?.outcome)).toEqual(['sent', 'skipped-busy']);
  });

  test('two routines with no terminal yet start one between them', async () => {
    // Arrange
    let open: { id: string; busy: boolean }[] = [];
    const { service, advance } = setup({
      newId: () => `r${Math.random()}`,
      terminalsIn: () => open,
      start: async () => {
        await Promise.resolve();
        open = [{ id: 't1', busy: true }];
      },
    });
    service.add(input);
    service.add(input);
    advance(10 * MINUTE);

    // Act
    await service.tick();

    // Assert
    expect(service.list().map((routine) => routine.history[0]?.outcome)).toEqual(['started', 'skipped-busy']);
  });

  test('a terminal that breaks while typing is a failed run, not a crash', async () => {
    // Arrange
    const { service, advance } = setup({
      terminalsIn: () => [{ id: 't1', busy: false }],
      paste: () => {
        throw new Error('closed');
      },
    });
    const { nextRunAt: first } = service.add(input);
    advance(10 * MINUTE);

    // Act
    await service.tick();

    // Assert
    expect(service.list()[0]?.history[0]).toMatchObject({ outcome: 'failed' });
    expect(service.list()[0]?.nextRunAt).toBeGreaterThan(first);
  });

  test('runs nothing while real terminals are off', async () => {
    // Arrange
    const { service, started, advance } = setup({ enabled: () => false });
    service.add(input);
    advance(10 * MINUTE);

    // Act
    await service.tick();

    // Assert
    expect(started).toEqual([]);
    expect(service.list()[0]?.history[0]).toMatchObject({ outcome: 'skipped-off' });
  });

  test('a paused routine does not run, and resuming counts from then', async () => {
    // Arrange
    const { service, started, advance } = setup();
    const { id } = service.add(input);
    service.setEnabled(id, false);
    advance(30 * MINUTE);

    // Act
    await service.tick();
    service.setEnabled(id, true);
    await service.tick();

    // Assert
    expect(started).toEqual([]);
  });

  test('a run that failed is recorded and the routine goes on', async () => {
    // Arrange
    const { service, advance } = setup({ start: () => Promise.reject(new Error('no')) });
    const { nextRunAt: first } = service.add(input);
    advance(10 * MINUTE);

    // Act
    await service.tick();

    // Assert
    expect(service.list()[0]?.history[0]).toMatchObject({ outcome: 'failed' });
    expect(service.list()[0]?.nextRunAt).toBeGreaterThan(first);
  });

  test('a time missed while the office was closed runs once, not once per missed turn', async () => {
    // Arrange
    const { service, started, advance } = setup();
    service.add(input);
    advance(600 * MINUTE);

    // Act
    await service.tick();
    await service.tick();

    // Assert
    expect(started).toHaveLength(1);
  });

  test('keeps a short history, newest first', async () => {
    // Arrange
    const { service, advance } = setup();
    service.add(input);

    // Act
    for (let turn = 0; turn < 30; turn += 1) {
      advance(10 * MINUTE);
      await service.tick();
    }

    // Assert
    expect(service.list()[0]?.history).toHaveLength(20);
    expect(service.list()[0]?.history[0]?.at).toBeGreaterThan(service.list()[0]?.history[1]?.at ?? 0);
  });

  test('can run now, can be removed, and has a limit', async () => {
    // Arrange
    const { service, started } = setup();
    const { id } = service.add(input);

    // Act
    const ran = await service.runNow(id);
    const removed = service.remove(id);
    for (let index = 0; index < MAX_ROUTINES; index += 1) service.add(input);

    // Assert
    expect(ran).toBe(true);
    expect(started).toHaveLength(1);
    expect(removed).toBe(true);
    expect(() => service.add(input)).toThrow('too-many');
  });

  test('comes back from what it saved, and forgets what is not valid', () => {
    // Arrange
    const { service } = setup();
    const saved = { ...service.add(input), nextRunAt: 5 };

    // Act
    const next = setup().service;
    next.restore([
      { ...saved, history: [{ at: 1, outcome: 'sent' }, { at: 2, outcome: 'hacked' }, 3] },
      { ...saved, nextRunAt: Number.POSITIVE_INFINITY },
      { id: 'bad' },
    ]);

    // Assert
    expect(next.list().map((routine) => routine.id)).toEqual([saved.id]);
    expect(next.list()[0]?.nextRunAt).toBe(5);
    expect(next.list()[0]?.history).toEqual([{ at: 1, outcome: 'sent' }]);
  });
});
