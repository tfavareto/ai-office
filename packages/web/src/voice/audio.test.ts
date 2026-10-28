import { describe, expect, it } from 'vitest';
import { concatBlocks, levelOf, mixToMono, peakOf, resample } from './audio';

const sine = (frequency: number, rate: number, seconds: number, amplitude = 1): Float32Array =>
  Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / rate),
  );

const rms = (samples: Float32Array): number => Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);

describe('concatBlocks', () => {
  it('joins the blocks in order into a new array', () => {
    const a = Float32Array.of(1, 2);
    const b = Float32Array.of(3);

    const joined = concatBlocks([a, b]);

    expect(Array.from(joined)).toEqual([1, 2, 3]);
    expect(Array.from(a)).toEqual([1, 2]);
  });

  it('gives an empty array for no blocks', () => {
    expect(concatBlocks([]).length).toBe(0);
  });
});

describe('mixToMono', () => {
  it('averages the channels', () => {
    const mono = mixToMono([Float32Array.of(1, 0, -1), Float32Array.of(0, 1, -1)]);

    expect(Array.from(mono)).toEqual([0.5, 0.5, -1]);
  });

  it('copies a single channel and handles none', () => {
    const channel = Float32Array.of(0.25, -0.5);

    const mono = mixToMono([channel]);

    expect(Array.from(mono)).toEqual([0.25, -0.5]);
    expect(mono).not.toBe(channel);
    expect(mixToMono([]).length).toBe(0);
  });
});

describe('resample', () => {
  it('turns 48 kHz into 16 kHz keeping the duration', () => {
    const out = resample(sine(440, 48_000, 1), 48_000, 16_000);

    expect(out.length).toBe(16_000);
  });

  it('turns 44.1 kHz into 16 kHz with a length that follows the ratio', () => {
    const out = resample(new Float32Array(44_100), 44_100, 16_000);

    expect(out.length).toBe(Math.floor(44_100 / (44_100 / 16_000)));
  });

  it('keeps a speech-band tone at about the same loudness', () => {
    const input = sine(440, 48_000, 1, 0.8);

    const out = resample(input, 48_000, 16_000);

    expect(rms(out)).toBeGreaterThan(rms(input) * 0.95);
    expect(rms(out)).toBeLessThan(rms(input) * 1.05);
  });

  it('keeps a constant signal constant, edges included', () => {
    const out = resample(new Float32Array(480).fill(0.5), 48_000, 16_000);

    expect(out.length).toBe(160);
    expect(Math.min(...out)).toBeCloseTo(0.5, 6);
    expect(Math.max(...out)).toBeCloseTo(0.5, 6);
  });

  it('averages the input each output sample covers', () => {
    const out = resample(Float32Array.of(1, 2, 3, 4, 5, 6), 48_000, 16_000);

    expect(Array.from(out)).toEqual([2, 5]);
  });

  it('weights the fractional edges when the ratio is not whole', () => {
    // 3 input samples per 2 output samples: each output covers 1.5 input samples.
    const out = resample(Float32Array.of(0, 3, 6, 9, 12, 15), 24_000, 16_000);

    expect(out.length).toBe(4);
    expect(out[0]).toBeCloseTo((0 * 1 + 3 * 0.5) / 1.5, 6);
    expect(out[1]).toBeCloseTo((3 * 0.5 + 6 * 1) / 1.5, 6);
  });

  it('mostly removes a tone far above the new Nyquist limit instead of folding it back as noise', () => {
    // 15 kHz would alias to 1 kHz at 16 kHz; the averaging leaves under a tenth of it.
    const above = resample(sine(15_000, 48_000, 1), 48_000, 16_000);
    const inBand = resample(sine(1_000, 48_000, 1), 48_000, 16_000);

    expect(rms(above)).toBeLessThan(rms(inBand) * 0.1);
  });

  it('interpolates when the rate goes up', () => {
    const out = resample(Float32Array.of(0, 1, 0), 8_000, 16_000);

    expect(Array.from(out)).toEqual([0, 0.5, 1, 0.5, 0, 0]);
  });

  it('copies the input when the rate does not change, and handles empty input', () => {
    const input = Float32Array.of(0.1, 0.2);

    const same = resample(input, 16_000, 16_000);

    expect(Array.from(same)).toEqual([...input]);
    expect(same).not.toBe(input);
    expect(resample(new Float32Array(0), 48_000, 16_000).length).toBe(0);
  });

  it('does not change its input', () => {
    const input = sine(300, 48_000, 0.1);
    const before = Array.from(input);

    resample(input, 48_000, 16_000);

    expect(Array.from(input)).toEqual(before);
  });

  it('refuses rates that are not positive', () => {
    expect(() => resample(Float32Array.of(1), 0, 16_000)).toThrow(RangeError);
    expect(() => resample(Float32Array.of(1), 48_000, -1)).toThrow(RangeError);
  });
});

describe('peakOf and levelOf', () => {
  it('finds the largest sample in either direction', () => {
    expect(peakOf(Float32Array.of(0.1, -0.7, 0.3))).toBeCloseTo(0.7, 6);
    expect(peakOf(new Float32Array(0))).toBe(0);
  });

  it('puts silence at 0 and full scale at 1 on the meter', () => {
    expect(levelOf(new Float32Array(100))).toBe(0);
    expect(levelOf(new Float32Array(0))).toBe(0);
    expect(levelOf(new Float32Array(100).fill(1))).toBe(1);
  });

  it('rises with loudness', () => {
    const quiet = levelOf(sine(300, 16_000, 0.1, 0.01));
    const medium = levelOf(sine(300, 16_000, 0.1, 0.1));
    const loud = levelOf(sine(300, 16_000, 0.1, 0.8));

    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(medium);
    expect(medium).toBeLessThan(loud);
    expect(loud).toBeLessThanOrEqual(1);
  });
});
