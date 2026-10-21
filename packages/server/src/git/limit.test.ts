import { describe, expect, test } from 'vitest';
import { limitRunner } from './limit';
import type { Runner } from './run';

function slowRunner(): { run: Runner; peak: () => number; started: () => number } {
  let active = 0;
  let peak = 0;
  let started = 0;
  const run: Runner = async (file) => {
    active++;
    started++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    active--;
    return file;
  };
  return { run, peak: () => peak, started: () => started };
}

describe('limitRunner', () => {
  test('never runs more programs than the cap, and runs all of them', async () => {
    // Arrange
    const { run, peak, started } = slowRunner();
    const limited = limitRunner(run, 2);
    // Act
    const results = await Promise.all(Array.from({ length: 9 }, (_, i) => limited(`p${i}`, [], { cwd: '/', timeoutMs: 1 })));
    // Assert
    expect(results).toEqual(Array.from({ length: 9 }, (_, i) => `p${i}`));
    expect(started()).toBe(9);
    expect(peak()).toBe(2);
  });

  test('frees the slot when a program fails', async () => {
    // Arrange
    let calls = 0;
    const failing: Runner = () => (++calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('ok'));
    const limited = limitRunner(failing, 1);
    // Act
    const first = limited('a', [], { cwd: '/', timeoutMs: 1 });
    const second = limited('b', [], { cwd: '/', timeoutMs: 1 });
    // Assert
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
  });
});
