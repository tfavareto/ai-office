// Pure audio math for the recorder: joining blocks, mixing to mono, resampling to 16 kHz and measuring levels.

/** Joins blocks into one array (new array; the blocks are not changed). */
export function concatBlocks(blocks: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(blocks.reduce((total, block) => total + block.length, 0));
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

/** Average of the channels, sample by sample. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (first === undefined) return new Float32Array(0);
  if (channels.length === 1) return first.slice();
  const out = new Float32Array(first.length);
  for (const channel of channels) for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) + (channel[i] ?? 0);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / channels.length;
  return out;
}

/**
 * Converts audio from one sample rate to another. Going down (48 kHz to 16 kHz) every output sample is the average of
 * the input it covers, which is a box low-pass filter: it keeps high frequencies from folding back as noise. Going up
 * it interpolates linearly. The result is a new array; the input is not changed.
 */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError('Sample rates must be positive');
  if (fromRate === toRate || input.length === 0) return input.slice();
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  if (ratio < 1) {
    for (let i = 0; i < length; i++) {
      const position = i * ratio;
      const left = Math.floor(position);
      const right = Math.min(left + 1, input.length - 1);
      const fraction = position - left;
      out[i] = (input[left] ?? 0) * (1 - fraction) + (input[right] ?? 0) * fraction;
    }
    return out;
  }
  for (let i = 0; i < length; i++) {
    const start = i * ratio;
    const end = Math.min(start + ratio, input.length);
    let sum = 0;
    for (let j = Math.floor(start); j < end; j++) {
      const weight = Math.min(j + 1, end) - Math.max(j, start);
      sum += (input[j] ?? 0) * weight;
    }
    out[i] = sum / (end - start);
  }
  return out;
}

/** Largest absolute sample, 0..1 for normal audio. */
export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

const METER_FLOOR_DB = -60;

/** Loudness of a block for a level meter: 0 at -60 dBFS (or quieter) up to 1 at full scale. */
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  if (rms === 0) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(rms) - METER_FLOOR_DB) / -METER_FLOOR_DB));
}
