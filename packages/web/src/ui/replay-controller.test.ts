import { describe, expect, test, vi } from 'vitest';
import {
  type OfficeSnapshot,
  type Timelapse,
  createDemoSimulator,
  dayRange,
  demoTimelapse,
  emptyTimelapse,
} from '@ai-office/shared';
import { BackendError, type Backend } from '../net/backend';
import { PRESENT_EVERY_MS, RENDER_EVERY_MS, ReplayController } from './replay-controller';

const NOW = new Date(2026, 9, 21, 15, 30).getTime();
const range = dayRange('2026-10-20');
if (range === undefined) throw new Error('no range');
const DAY = demoTimelapse({
  range,
  now: NOW,
  locale: 'en',
  agents: createDemoSimulator({ seed: 3, now: () => NOW }).agents(),
  account: 'all',
});
const FROM = DAY.from ?? 0;
const TO = DAY.to ?? 0;

interface Harness {
  controller: ReplayController;
  presented: { snapshot: OfficeSnapshot; at: number; jump: boolean }[];
  renders: () => number;
  /** Runs the frame loop: `frames` frames of `stepMs` each. */
  run(frames: number, stepMs: number): void;
  requested: string[];
}

function harness(load: (query: { date: string; account: string }) => Promise<Timelapse> = async () => DAY): Harness {
  const presented: Harness['presented'] = [];
  const requested: string[] = [];
  let renders = 0;
  let pending: ((stamp: number) => void) | undefined;
  let stamp = 1000;
  const backend = {
    timelapse: async (query: { date: string; account: string }) => (
      requested.push(`${query.date}|${query.account}`),
      load(query)
    ),
  } as unknown as Backend;
  const controller = new ReplayController({
    backend: () => backend,
    account: () => 'all',
    base: () => ({ accounts: [], meta: undefined }),
    present: (snapshot, at, jump) => presented.push({ snapshot, at, jump }),
    render: () => void renders++,
    frame: (callback) => {
      pending = callback;
      return 1;
    },
    cancelFrame: () => {
      pending = undefined;
    },
  });
  return {
    controller,
    presented,
    requested,
    renders: () => renders,
    run(frames, stepMs) {
      for (let i = 0; i < frames; i++) {
        const callback = pending;
        pending = undefined;
        if (callback === undefined) return;
        stamp += stepMs;
        callback(stamp);
      }
    },
  };
}

describe('starting', () => {
  test('loads the day, then plays it from the start with the world placed at once', async () => {
    const { controller, presented, requested } = harness();
    const loading = controller.start('2026-10-20');

    expect(controller.get().phase).toBe('loading');
    expect(controller.engaged).toBe(true);
    expect(controller.active).toBe(false);
    await loading;

    expect(requested).toEqual(['2026-10-20|all']);
    expect(controller.get()).toMatchObject({
      phase: 'ready',
      date: '2026-10-20',
      empty: false,
      playing: true,
      speed: 600,
    });
    expect(controller.clock).toMatchObject({ from: FROM, to: TO, t: FROM });
    expect(presented).toHaveLength(1);
    expect(presented[0]).toMatchObject({ at: FROM, jump: true });
    expect(controller.snapshot?.serverTime).toBe(FROM);
    expect(controller.markers.length).toBeGreaterThan(0);
    expect(controller.timelapse?.date).toBe(DAY.date);
  });

  test('says where the notes of the day come from', async () => {
    const { controller } = harness(async () => ({ ...DAY, truncated: true }));
    await controller.start('2026-10-20');

    expect(controller.get().notes).toEqual({ truncated: true, trimmed: false, demo: true });
  });

  test('a failed load is an error that says why, and a retry works', async () => {
    let fail = true;
    const { controller } = harness(async () => {
      if (fail) throw new BackendError('x', 403);
      return DAY;
    });
    await controller.start('2026-10-20');

    expect(controller.get()).toMatchObject({ phase: 'error', date: '2026-10-20' });
    expect(controller.get().error).toBeTruthy();
    expect(controller.active).toBe(false);
    fail = false;
    await controller.start('2026-10-20');
    expect(controller.get().phase).toBe('ready');
  });

  test('an empty day is ready but has nothing to play', async () => {
    const empty = emptyTimelapse({
      date: '2026-10-19',
      generatedAt: 1,
      account: 'all',
      start: range.start,
      end: range.end,
    });
    const { controller, presented } = harness(async () => empty);
    await controller.start('2026-10-19');
    controller.togglePlay();
    controller.seek(5);

    expect(controller.get()).toMatchObject({ phase: 'ready', empty: true, playing: false });
    expect(controller.clock).toBeUndefined();
    expect(controller.snapshot?.agents).toEqual([]);
    expect(presented).toHaveLength(1);
  });

  test('only the last day asked for counts when answers arrive out of order', async () => {
    const answers = new Map<string, (value: Timelapse) => void>();
    const { controller } = harness((query) => new Promise<Timelapse>((resolve) => answers.set(query.date, resolve)));
    const first = controller.start('2026-10-19');
    const second = controller.start('2026-10-20');
    answers.get('2026-10-20')?.({ ...DAY, date: '2026-10-20' });
    await second;
    answers.get('2026-10-19')?.({ ...DAY, date: '2026-10-19' });
    await first;

    expect(controller.get()).toMatchObject({ phase: 'ready', date: '2026-10-20' });
  });

  test('switching days keeps the old day on screen, frozen, until the new one is there', async () => {
    const { controller } = harness();
    await controller.start('2026-10-20');
    controller.seek(FROM + 3_600_000);
    const before = controller.snapshot;
    void controller.start('2026-10-19');

    expect(controller.get().phase).toBe('loading');
    expect(controller.snapshot).toBe(before);
    controller.togglePlay();
    expect(controller.clock?.playing).toBe(true);
  });
});

describe('playing', () => {
  test('advances the day at the chosen speed, one frame at a time, without notifying the view', async () => {
    const { controller, run } = harness();
    await controller.start('2026-10-20');
    const view = vi.fn();
    const frames: number[] = [];
    controller.subscribe(view);
    controller.onFrame((clock) => frames.push(clock.t));
    run(1, 0);
    run(3, 16);

    expect(frames).toHaveLength(4);
    expect((controller.clock?.t ?? 0) - FROM).toBe(3 * 16 * 600);
    expect(view).not.toHaveBeenCalled();
  });

  test('the world gets a snapshot at most every 50 ms, and the panels a refresh every quarter second', async () => {
    const { controller, presented, renders, run } = harness();
    await controller.start('2026-10-20');
    const baseline = [presented.length, renders()];
    run(1, 0);
    run(30, 16);

    const shown = presented.length - baseline[0];
    expect(shown).toBeGreaterThanOrEqual(8);
    expect(shown).toBeLessThanOrEqual(Math.ceil((30 * 16) / PRESENT_EVERY_MS) + 1);
    expect(presented.slice(1).every((frame) => !frame.jump)).toBe(true);
    expect(renders() - baseline[1]).toBeLessThanOrEqual(Math.ceil((30 * 16) / RENDER_EVERY_MS) + 1);
  });

  test('speed changes how much day one second is, and tells the view', async () => {
    const { controller, run } = harness();
    await controller.start('2026-10-20');
    const view = vi.fn();
    controller.subscribe(view);
    controller.setSpeed(1800);
    run(1, 0);
    run(1, 100);

    expect(view).toHaveBeenCalledTimes(1);
    expect(controller.get().speed).toBe(1800);
    expect((controller.clock?.t ?? 0) - FROM).toBe(100 * 1800);
  });

  test('pausing stops the clock and the loop; playing again continues from the same place', async () => {
    const { controller, run } = harness();
    await controller.start('2026-10-20');
    run(1, 0);
    run(2, 100);
    controller.togglePlay();
    const paused = controller.clock?.t;
    run(5, 100);

    expect(controller.get().playing).toBe(false);
    expect(controller.clock?.t).toBe(paused);
    controller.togglePlay();
    run(1, 0);
    run(1, 100);
    expect((controller.clock?.t ?? 0) - (paused ?? 0)).toBe(100 * 600);
  });

  test('stops at the end of the day, shows the final state, and starts over when asked to play again', async () => {
    const { controller, presented, run } = harness();
    await controller.start('2026-10-20');
    controller.setSpeed(1800);
    run(1, 0);
    run(10_000, 250);

    expect(controller.clock).toMatchObject({ t: TO, playing: false });
    expect(controller.get().playing).toBe(false);
    expect(presented[presented.length - 1]?.at).toBe(TO);
    controller.togglePlay();
    expect(controller.clock).toMatchObject({ t: FROM, playing: true });
  });
});

describe('seeking', () => {
  test('jumps the world to the instant at once, whatever the speed or the state', async () => {
    const { controller, presented } = harness();
    await controller.start('2026-10-20');
    const middle = FROM + Math.floor((TO - FROM) / 2);
    controller.seek(middle);

    expect(presented[presented.length - 1]).toMatchObject({ at: middle, jump: true });
    expect(controller.clock?.t).toBe(middle);
    expect(controller.snapshot?.serverTime).toBe(middle);
    controller.seek(TO + 1e9);
    expect(controller.clock).toMatchObject({ t: TO, playing: false });
    controller.seek(FROM - 1e9);
    expect(controller.clock?.t).toBe(FROM);
  });

  test('skips forwards and backwards', async () => {
    const { controller } = harness();
    await controller.start('2026-10-20');
    controller.skip(600_000);
    expect(controller.clock?.t).toBe(FROM + 600_000);
    controller.skip(-60_000);
    expect(controller.clock?.t).toBe(FROM + 540_000);
  });

  test('the state at an instant is the same whether the clock played to it or jumped to it', async () => {
    const played = harness();
    await played.controller.start('2026-10-20');
    played.run(1, 0);
    played.run(200, 16);
    const at = played.controller.clock?.t ?? 0;
    const playedSnapshot = JSON.stringify({ ...played.controller.snapshot, rev: 0 });

    const jumped = harness();
    await jumped.controller.start('2026-10-20');
    jumped.controller.seek(at);

    expect(JSON.stringify({ ...jumped.controller.snapshot, rev: 0 })).toBe(playedSnapshot);
    expect(jumped.controller.feed().map((item) => item.id)).toEqual(played.controller.feed().map((item) => item.id));
  });
});

describe('the feed and the snapshot', () => {
  test('the feed follows the clock', async () => {
    const { controller } = harness();
    await controller.start('2026-10-20');
    const early = controller.feed().length;
    controller.seek(TO);

    expect(controller.feed().length).toBeGreaterThan(early);
    expect(controller.feed().length).toBeLessThanOrEqual(100);
    expect(controller.feed()).toBe(controller.feed());
  });

  test('the snapshot is a replay one: not local, demo when the day is, with rising revisions', async () => {
    const { controller } = harness();
    await controller.start('2026-10-20');
    const first = controller.snapshot?.rev ?? 0;
    controller.seek(TO);

    expect(controller.snapshot?.meta).toMatchObject({ local: false, demo: true });
    expect(controller.snapshot?.rev).toBeGreaterThan(first);
  });
});

describe('stopping', () => {
  test('leaves the mode: nothing to show, no loop, no late answers', async () => {
    const answers: ((value: Timelapse) => void)[] = [];
    const { controller, run } = harness(() => new Promise<Timelapse>((resolve) => answers.push(resolve)));
    const loading = controller.start('2026-10-20');
    controller.stop();
    answers[0]?.(DAY);
    await loading;

    expect(controller.get().phase).toBe('off');
    expect(controller.engaged).toBe(false);
    expect(controller.snapshot).toBeNull();
    run(3, 16);
    expect(controller.clock).toBeUndefined();
  });

  test('after playing, leaves a clean slate', async () => {
    const { controller } = harness();
    await controller.start('2026-10-20');
    controller.stop();

    expect(controller.snapshot).toBeNull();
    expect(controller.feed()).toEqual([]);
    expect(controller.markers).toEqual([]);
    controller.seek(FROM + 1);
    expect(controller.clock).toBeUndefined();
  });
});
