// The browser pieces of voice input: capability check and the Whisper worker. Kept apart from the state machine so the
// state machine can be tested with fakes.
import type { WhisperWorker } from './worker/protocol';

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
