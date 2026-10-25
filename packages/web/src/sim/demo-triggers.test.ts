import { createDemoSimulator } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { TriggerTracker, type TriggerKind } from './triggers';

/** Plays the demo story at its normal speed and records which celebrations it earns, and when (seconds). */
function playDemo(seed: number, seconds: number): Map<TriggerKind, number[]> {
  const start = 1_700_000_000_000;
  let clock = start;
  const demo = createDemoSimulator({ seed, now: () => clock });
  const tracker = new TriggerTracker();
  const found = new Map<TriggerKind, number[]>();
  for (let t = 0; t <= seconds; t += 0.5) {
    clock = start + t * 1000;
    demo.tick(clock);
    for (const trigger of tracker.update(demo.snapshot(clock))) {
      found.set(trigger.kind, [...(found.get(trigger.kind) ?? []), t]);
    }
  }
  return found;
}

describe('demo mode celebrations', () => {
  it('earns tests fixed, finished task lists and commits within a few minutes', () => {
    for (const seed of [1, 2, 3]) {
      const found = playDemo(seed, 150);
      expect(found.get('tasks-done')?.length ?? 0, `tasks-done, seed ${seed}`).toBeGreaterThan(0);
      expect(found.get('commit')?.length ?? 0, `commit, seed ${seed}`).toBeGreaterThan(0);
      expect(found.get('tests-fixed')?.length ?? 0, `tests-fixed, seed ${seed}`).toBeGreaterThan(0);
    }
  }, 30_000);

  it('also sees subagents finish well and long turns end', () => {
    const found = new Map<TriggerKind, number>();
    for (const seed of [1, 2, 3]) {
      for (const [kind, times] of playDemo(seed, 120)) found.set(kind, (found.get(kind) ?? 0) + times.length);
    }
    expect(found.get('subagent-done') ?? 0).toBeGreaterThan(0);
    expect(found.get('streak-end') ?? 0).toBeGreaterThan(0);
  }, 30_000);
});
