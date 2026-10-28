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

// ---- getting a take ready for Whisper ----------------------------------------------------------------------------

/** Loudness is measured in frames of 20 ms. */
const FRAME_MS = 20;
/** Speech is what stands this far (x4, 12 dB) above the quietest tenth of the take... */
const NOISE_FACTOR = 4;
const NOISE_PERCENTILE = 0.1;
/** ...but never more than 20 dB under the loudest frame (a take that is all speech has no quiet tenth)... */
const LOUDEST_FRACTION = 0.1;
/** ...and never under this level (-54 dBFS), so the hiss of a silent room does not count as speech. */
const MIN_SPEECH_RMS = 0.002;
/** Kept around the speech on each side: soft word onsets and endings sit under the threshold. */
const PAD_MS = 300;
/** The loudest sample after normalizing, and the most a quiet take is amplified (x8, 18 dB). */
const TARGET_PEAK = 0.9;
const MAX_GAIN = 8;

function frameLevels(samples: Float32Array, frame: number): Float32Array {
  const levels = new Float32Array(Math.ceil(samples.length / frame));
  for (let f = 0; f < levels.length; f++) {
    const end = Math.min(samples.length, (f + 1) * frame);
    let sum = 0;
    for (let i = f * frame; i < end; i++) sum += (samples[i] ?? 0) ** 2;
    levels[f] = Math.sqrt(sum / Math.max(1, end - f * frame));
  }
  return levels;
}

function speechThreshold(levels: Float32Array): number {
  const sorted = levels.slice().sort();
  const floor = sorted[Math.floor((sorted.length - 1) * NOISE_PERCENTILE)] ?? 0;
  const loudest = sorted[sorted.length - 1] ?? 0;
  return Math.max(MIN_SPEECH_RMS, Math.min(floor * NOISE_FACTOR, loudest * LOUDEST_FRACTION));
}

/**
 * The part of the take that holds speech, with a little margin: the silence before the first word and after the last is
 * dropped (Whisper tends to invent words, "Obrigado." above all, in trailing silence). Null when nothing is speech.
 */
export function trimSilence(samples: Float32Array, sampleRate: number): Float32Array | null {
  const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const levels = frameLevels(samples, frame);
  const threshold = speechThreshold(levels);
  const first = levels.findIndex((level) => level >= threshold);
  if (first < 0) return null;
  let last = levels.length - 1;
  while (last > first && (levels[last] ?? 0) < threshold) last--;
  const pad = Math.round((sampleRate * PAD_MS) / 1000);
  const start = Math.max(0, first * frame - pad);
  const end = Math.min(samples.length, (last + 1) * frame + pad);
  return samples.slice(start, end);
}

/** Scales the take so its loudest sample is at 0.9, amplifying at most 8x (a new array). */
export function normalizeGain(samples: Float32Array): Float32Array {
  const peak = peakOf(samples);
  if (peak === 0) return samples.slice();
  const gain = Math.min(MAX_GAIN, TARGET_PEAK / peak);
  return samples.map((sample) => sample * gain);
}

/** Trimmed and normalized speech, ready for the model, or null when the take holds none. */
export function prepareSpeech(samples: Float32Array, sampleRate: number): Float32Array | null {
  const speech = trimSilence(samples, sampleRate);
  return speech === null ? null : normalizeGain(speech);
}
