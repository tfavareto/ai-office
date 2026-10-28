// The browser pieces of voice input: capability check and the Whisper worker. Kept apart from the state machine so the
// state machine can be tested with fakes.
import { wasmThreads, type VoiceCapabilities } from './engine';
import type { WhisperWorker } from './worker/protocol';

/** WebGPU with 16-bit floats in shaders (large-v3-turbo's encoder is 16-bit). Any failure means no. */
async function hasWebGpuF16(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || navigator.gpu === undefined) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return adapter?.features.has('shader-f16') === true;
  } catch {
    return false;
  }
}

/** What this browser offers the speech model: WebGPU, and CPU threads (only on a cross-origin isolated page). */
export async function detectVoiceCapabilities(): Promise<VoiceCapabilities> {
  const isolated = globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function';
  const cores = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency;
  return { webgpu: await hasWebGpuF16(), threads: wasmThreads(isolated, cores) };
}

/** Microphone, audio worklets, workers and WebAssembly are all needed, on a page the browser trusts (127.0.0.1 is). */
export function isVoiceSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof Worker !== 'undefined' &&
    typeof WebAssembly === 'object' &&
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/** The Whisper worker; its code (transformers.js) is a chunk of its own, fetched only when this is first called. */
export function createBrowserWhisperWorker(): WhisperWorker {
  const worker = new Worker(new URL('./worker/whisper.worker.ts', import.meta.url), { type: 'module' });
  return {
    post: (message, transfer = []) => worker.postMessage(message, transfer),
    onMessage: (listener) => {
      worker.onmessage = (event) => listener(event.data);
    },
    onFailure: (listener) => {
      worker.onerror = () => listener();
      worker.onmessageerror = () => listener();
    },
    terminate: () => worker.terminate(),
  };
}
