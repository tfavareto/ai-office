import { describe, expect, test } from 'vitest';
import {
  BIG_SKIP_MS,
  DEFAULT_SPEED,
  MAX_FRAME_MS,
  SKIP_MS,
  SPEEDS,
  advance,
  atEnd,
  isSpeed,
  pause,
  progress,
  seek,
  setSpeed,
  skip,
  startClock,
  timeAt,
  togglePlay,
} from './clock';

const FROM = 1_000_000;
const TO = FROM + 8 * 3_600_000;

describe('startClock', () => {
  test('starts playing at the beginning of the span, at the default speed', () => {
    expect(startClock(FROM, TO)).toEqual({ from: FROM, to: TO, t: FROM, speed: DEFAULT_SPEED, playing: true });
  });

  test('a span that ends before it starts is a point', () => {
    expect(startClock(FROM, FROM - 5)).toMatchObject({ from: FROM, to: FROM });
  });

  test('offers the four speeds', () => {
    expect([...SPEEDS]).toEqual([30, 120, 600, 1800]);
    expect(isSpeed(120)).toBe(true);
    expect(isSpeed(60)).toBe(false);
  });
});

describe('advance', () => {
  test.each(SPEEDS)('at %s× one real second is that many seconds of the day', (speed) => {
    const clock = setSpeed(startClock(FROM, TO), speed);

    expect(advance(clock, 100).t - FROM).toBe(100 * speed);
    expect(advance(advance(clock, 100), 100).t - FROM).toBe(200 * speed);
  });

  test('does not move a paused clock, and ignores a frame without time', () => {
    const paused = pause(startClock(FROM, TO));

    expect(advance(paused, 1000)).toBe(paused);
    expect(advance(startClock(FROM, TO), 0).t).toBe(FROM);
  });

  test('a frame that took too long counts as a normal long one (a tab that was in the background)', () => {
    const clock = startClock(FROM, TO);

    expect(advance(clock, 60_000).t - FROM).toBe(MAX_FRAME_MS * DEFAULT_SPEED);
  });

  test('stops at the end of the span, and says so', () => {
    const near = { ...startClock(FROM, TO), t: TO - 10 };
    const done = advance(near, 100);

    expect(done).toMatchObject({ t: TO, playing: false });
    expect(atEnd(done)).toBe(true);
    expect(advance(done, 100)).toBe(done);
  });
});

describe('seek', () => {
  test('jumps anywhere in the span and keeps playing or staying paused', () => {
    expect(seek(startClock(FROM, TO), FROM + 5000)).toMatchObject({ t: FROM + 5000, playing: true });
    expect(seek(pause(startClock(FROM, TO)), FROM + 5000)).toMatchObject({ t: FROM + 5000, playing: false });
  });

  test('is clamped to the span; reaching the end stops the clock', () => {
    const clock = startClock(FROM, TO);

    expect(seek(clock, FROM - 1e9).t).toBe(FROM);
    expect(seek(clock, TO + 1e9)).toMatchObject({ t: TO, playing: false });
  });

  test('is the same wherever the clock was: no memory of the path', () => {
    const played = advance(advance(startClock(FROM, TO), 200), 200);
    const fresh = startClock(FROM, TO);

    expect(seek(played, FROM + 12345).t).toBe(seek(fresh, FROM + 12345).t);
  });

  test('skips by a minute or ten, forwards or backwards', () => {
    const clock = seek(startClock(FROM, TO), FROM + 3_600_000);

    expect(skip(clock, SKIP_MS).t).toBe(clock.t + SKIP_MS);
    expect(skip(clock, -BIG_SKIP_MS).t).toBe(clock.t - BIG_SKIP_MS);
    expect(skip(startClock(FROM, TO), -SKIP_MS).t).toBe(FROM);
  });
});

describe('play and pause', () => {
  test('toggles', () => {
    const playing = startClock(FROM, TO);
    const paused = togglePlay(playing);

    expect(paused.playing).toBe(false);
    expect(togglePlay(paused).playing).toBe(true);
    expect(pause(paused)).toBe(paused);
  });

  test('playing again at the end starts the day over', () => {
    const finished = seek(startClock(FROM, TO), TO);

    expect(togglePlay(finished)).toMatchObject({ t: FROM, playing: true });
  });

  test('changing the speed keeps the place and the play state', () => {
    const clock = seek(startClock(FROM, TO), FROM + 777);

    expect(setSpeed(clock, 1800)).toMatchObject({ t: FROM + 777, playing: true, speed: 1800 });
  });
});

describe('position', () => {
  test('progress and timeAt are inverses; an empty span is complete', () => {
    const clock = seek(startClock(FROM, TO), FROM + (TO - FROM) / 4);

    expect(progress(clock)).toBeCloseTo(0.25);
    expect(timeAt(clock, 0.25)).toBeCloseTo(clock.t);
    expect(timeAt(clock, 2)).toBe(TO);
    expect(timeAt(clock, -1)).toBe(FROM);
    expect(progress(startClock(FROM, FROM))).toBe(1);
  });
});
