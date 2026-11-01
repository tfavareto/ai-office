// Where the speech model runs in this browser, and which model that means. Large-v3-turbo needs the graphics card
// (WebGPU with 16-bit floats); without it the page uses `small` on the CPU instead. The CPU (WebAssembly) path uses
// several threads when the page is cross-origin isolated, which the AI Office server makes it.
import type { VoiceModelSize } from '@ai-office/shared';

/** What this browser offers the model. */
export interface VoiceCapabilities {
  /** WebGPU with `shader-f16`: what the 16-bit large-v3-turbo encoder needs. */
  webgpu: boolean;
  /** CPU threads the WebAssembly backend may use (1 when the page is not cross-origin isolated). */
  threads: number;
}

/** Where a model runs: WebGPU, WebAssembly on several threads, or WebAssembly on one. */
export type VoiceBackend = 'webgpu' | 'wasm-threads' | 'wasm';
export type VoiceDevice = 'webgpu' | 'wasm';

/** The model the voice input really loads for a preference, and where. */
export interface ActiveVoiceModel {
  size: VoiceModelSize;
  device: VoiceDevice;
  backend: VoiceBackend;
  threads: number;
  /** The person picked a model this browser cannot run; `size` is the one used in its place. */
  fallbackFrom?: VoiceModelSize;
}

/** How long the last take was and how long it took to transcribe, for an honest speed hint. */
export interface VoiceTakeTiming {
  size: VoiceModelSize;
  backend: VoiceBackend;
  audioMs: number;
  ms: number;
}

/**
 * The model that replaces large-v3-turbo where WebGPU is missing: its pinned 16-bit encoder does not load on the CPU
 * backend (measured), and on the CPU small is already several times slower than turbo on the graphics card.
 */
export const CPU_FALLBACK_SIZE: VoiceModelSize = 'small';
/** Threads beyond this add little to Whisper on WebAssembly and take cores from the rest of the page. */
const MAX_WASM_THREADS = 4;

/** Threads for WebAssembly: one per core but one (the page needs a core too), at most four; one when not isolated. */
export function wasmThreads(isolated: boolean, cores: number): number {
  if (!isolated || !Number.isFinite(cores)) return 1;
  return Math.min(MAX_WASM_THREADS, Math.max(1, Math.floor(cores) - 1));
}

/** Which models need the graphics card: their files are the 16-bit WebGPU ones. */
export function needsWebGpu(size: VoiceModelSize): boolean {
  return size === 'turbo';
}

export function activeVoiceModel(preferred: VoiceModelSize, capabilities: VoiceCapabilities): ActiveVoiceModel {
  const threads = capabilities.threads;
  const cpuBackend: VoiceBackend = threads > 1 ? 'wasm-threads' : 'wasm';
  if (!needsWebGpu(preferred)) return { size: preferred, device: 'wasm', backend: cpuBackend, threads };
  if (capabilities.webgpu) return { size: preferred, device: 'webgpu', backend: 'webgpu', threads };
  return { size: CPU_FALLBACK_SIZE, device: 'wasm', backend: cpuBackend, threads, fallbackFrom: preferred };
}

/** The capabilities, found once, and the timing of the last take; shared by the voice input and the settings row. */
export interface VoiceEngine {
  /** Undefined until `ready()` has resolved once. */
  capabilities(): VoiceCapabilities | undefined;
  /** Finds the capabilities (once). Never rejects: a failed check means no WebGPU and one thread. */
  ready(): Promise<VoiceCapabilities>;
  lastTake(): VoiceTakeTiming | undefined;
  recordTake(timing: VoiceTakeTiming): void;
  onChange(listener: () => void): () => void;
}

const NO_CAPABILITIES: VoiceCapabilities = { webgpu: false, threads: 1 };

export function createVoiceEngine(detect: () => Promise<VoiceCapabilities>): VoiceEngine {
  let capabilities: VoiceCapabilities | undefined;
  let detecting: Promise<VoiceCapabilities> | undefined;
  let lastTake: VoiceTakeTiming | undefined;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return {
    capabilities: () => capabilities,
    ready() {
      detecting ??= detect()
        .catch(() => NO_CAPABILITIES)
        .then((found) => {
          capabilities = found;
          notify();
          return found;
        });
      return detecting;
    },
    lastTake: () => lastTake,
    recordTake(timing) {
      lastTake = { ...timing };
      notify();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
