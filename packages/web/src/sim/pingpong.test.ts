import { describe, expect, it } from 'vitest';
import { ballAt, type PingPongTable } from './pingpong';

const table = (playing: boolean): PingPongTable => ({ ax: 7.5, ay: 5.5, bx: 13.5, by: 5.5, playing, seed: 3 });

describe('ping-pong ball', () => {
  it('rests on the table when nobody plays', () => {
    const ball = ballAt(table(false), 12.3);
    expect(ball.z).toBe(0);
    expect(ball.x).toBeGreaterThan(7.5);
    expect(ball.x).toBeLessThan(13.5);
  });

  it('stays between the players and above the table while they rally', () => {
    for (let t = 0; t < 6; t += 0.05) {
      const ball = ballAt(table(true), t);
      expect(ball.x).toBeGreaterThanOrEqual(7.5);
      expect(ball.x).toBeLessThanOrEqual(13.5);
      expect(ball.z).toBeGreaterThanOrEqual(0);
      expect(ball.z).toBeLessThanOrEqual(0.6);
    }
  });

  it('goes back and forth', () => {
    const xs = Array.from({ length: 40 }, (_, i) => ballAt(table(true), i * 0.05).x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(3);
    const turns = xs
      .slice(2)
      .filter((x, i) => (x - (xs[i + 1] as number)) * ((xs[i + 1] as number) - (xs[i] as number)) < 0);
    expect(turns.length).toBeGreaterThan(0);
  });
});
