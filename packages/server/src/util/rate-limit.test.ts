import { describe, expect, test } from 'vitest';
import { RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
  test('allows up to the limit inside the window and refuses the next one', () => {
    const clock = 0;
    const limiter = new RateLimiter(3, 60_000, () => clock);

    expect([limiter.tryAcquire(), limiter.tryAcquire(), limiter.tryAcquire(), limiter.tryAcquire()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  test('frees a slot when the oldest event leaves the window', () => {
    let clock = 0;
    const limiter = new RateLimiter(2, 1000, () => clock);
    limiter.tryAcquire();
    clock = 400;
    limiter.tryAcquire();

    clock = 999;
    expect(limiter.tryAcquire()).toBe(false);
    clock = 1000;
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  test('a refused attempt does not extend the wait', () => {
    let clock = 0;
    const limiter = new RateLimiter(1, 1000, () => clock);
    limiter.tryAcquire();

    clock = 500;
    limiter.tryAcquire();
    clock = 1000;

    expect(limiter.tryAcquire()).toBe(true);
  });
});
