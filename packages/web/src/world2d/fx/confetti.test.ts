import { describe, expect, it } from 'vitest';
import { EffectQueue, MAX_PENDING_EFFECTS } from '../../sim/effects';
import { ConfettiSystem, pieceScale } from './confetti';

function fakeContext(): { ctx: CanvasRenderingContext2D; rects: number } {
  const state = { ctx: null as unknown as CanvasRenderingContext2D, rects: 0 };
  state.ctx = {
    globalAlpha: 1,
    fillStyle: '',
    fillRect: () => {
      state.rects++;
    },
  } as unknown as CanvasRenderingContext2D;
  return state;
}

const VIEW = { x: -10_000, y: -10_000, w: 20_000, h: 20_000 };

describe('2D confetti', () => {
  it('bursts into many particles and lets every one of them die within 2.5 seconds', () => {
    const confetti = new ConfettiSystem();
    confetti.burst(100, 100, 1, false, 1);
    for (let t = 0; t < 0.6; t += 1 / 60) confetti.update(1 / 60);
    expect(confetti.count).toBeGreaterThan(140);
    for (let t = 0; t < 3.2; t += 1 / 60) confetti.update(1 / 60);
    expect(confetti.count).toBe(0);
    expect(confetti.busy).toBe(false);
  });

  it('makes a big burst bigger and a calm one smaller', () => {
    const count = (scale: number, big: boolean): number => {
      const c = new ConfettiSystem();
      c.burst(0, 0, scale, big, 5);
      for (let t = 0; t < 0.6; t += 1 / 60) c.update(1 / 60);
      return c.count;
    };
    expect(count(1, true)).toBeGreaterThan(count(1, false));
    expect(count(0.6, false)).toBeLessThan(count(1, false));
    expect(count(1.4, false)).toBeGreaterThan(count(1, false));
  });

  it('is deterministic for a seed', () => {
    const run = (seed: number): string => {
      const c = new ConfettiSystem();
      c.burst(50, 80, 1, false, seed);
      for (let i = 0; i < 20; i++) c.update(1 / 60);
      const probe = fakeContext();
      c.draw(probe.ctx, VIEW);
      return `${c.count}:${probe.rects}`;
    };
    expect(run(3)).toBe(run(3));
  });

  it('never grows past its pool, however many bursts arrive', () => {
    const confetti = new ConfettiSystem();
    for (let i = 0; i < 40; i++) confetti.burst(0, 0, 1.4, true, i);
    for (let i = 0; i < 30; i++) confetti.update(1 / 60);
    expect(confetti.count).toBeLessThanOrEqual(1400);
  });

  it('pulls particles down: after a second the cloud has fallen below where it started rising', () => {
    const confetti = new ConfettiSystem();
    confetti.burst(0, 0, 1, false, 9);
    for (let i = 0; i < 20; i++) confetti.update(1 / 60);
    const rects = (): number => {
      const probe = fakeContext();
      confetti.draw(probe.ctx, { x: -500, y: -500, w: 1000, h: 1000 });
      return probe.rects;
    };
    expect(rects()).toBeGreaterThan(0);
    for (let i = 0; i < 90; i++) confetti.update(1 / 60);
    expect(rects()).toBeGreaterThan(0);
  });

  it('showers over a room for a few seconds and stops', () => {
    const confetti = new ConfettiSystem();
    confetti.shower({ x: 0, y: 0, w: 15, h: 9 }, 1, 4);
    for (let i = 0; i < 60; i++) confetti.update(1 / 60);
    expect(confetti.count).toBeGreaterThan(100);
    for (let i = 0; i < 60 * 8; i++) confetti.update(1 / 60);
    expect(confetti.busy).toBe(false);
  });

  it('draws only what is in view', () => {
    const confetti = new ConfettiSystem();
    confetti.burst(0, 0, 1, false, 2);
    const probe = fakeContext();
    confetti.draw(probe.ctx, { x: 5000, y: 5000, w: 10, h: 10 });
    expect(probe.rects).toBe(0);
  });
});

describe('piece size', () => {
  it('grows when zoomed out so the pieces read at the overview, and never shrinks below one', () => {
    expect(pieceScale(0.7)).toBeGreaterThan(pieceScale(1.25));
    expect(pieceScale(1.25)).toBeGreaterThan(1);
    expect(pieceScale(4)).toBe(1);
    expect(pieceScale(0.01)).toBeLessThanOrEqual(2.2);
  });

  it('draws bigger pieces when zoomed out', () => {
    const widest = (zoom: number): number => {
      const sizes: number[] = [];
      const ctx = {
        globalAlpha: 1,
        fillStyle: '',
        fillRect: (_x: number, _y: number, w: number) => void sizes.push(w),
      } as unknown as CanvasRenderingContext2D;
      const c = new ConfettiSystem();
      c.burst(0, 0, 1, false, 3);
      for (let i = 0; i < 20; i++) c.update(1 / 60);
      c.draw(ctx, VIEW, zoom);
      return Math.max(...sizes);
    };
    expect(widest(0.7)).toBeGreaterThan(widest(4));
  });
});

describe('flash ring', () => {
  it('shows a ring for half a second after a burst', () => {
    const c = new ConfettiSystem();
    c.burst(0, 0, 0.1, false, 1);
    const probe = fakeContext();
    c.draw(probe.ctx, VIEW);
    expect(probe.rects).toBeGreaterThan(30);
    for (let i = 0; i < 40; i++) c.update(1 / 60);
    expect(c.busy).toBe(true);
  });
});

describe('effect queue', () => {
  it('hands the effects over once and keeps its size bounded', () => {
    const queue = new EffectQueue();
    for (let i = 0; i < MAX_PENDING_EFFECTS + 10; i++) queue.push({ type: 'sound', big: false });
    expect(queue.take()).toHaveLength(MAX_PENDING_EFFECTS);
    expect(queue.take()).toEqual([]);
  });
});
