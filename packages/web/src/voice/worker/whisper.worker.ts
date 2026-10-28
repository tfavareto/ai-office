// The Whisper worker: transformers.js runs here, off the main thread, on the WebAssembly backend. It only ever reads the
// model from this server (`allowRemoteModels = false`), and the WebAssembly runtime it needs is a file of this build.
import { env, pipeline } from '@huggingface/transformers';
import ortFactoryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { createWhisperHandler, type Transcriber, type WhisperRuntime } from './whisper-handler';

interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const PERCENT = 100;

const runtime: WhisperRuntime = {
  async load(model, baseUrl, onProgress) {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = baseUrl;
    // The files come from AI Office on every load; the browser keeps no second copy of the model.
    env.useBrowserCache = false;
    env.useWasmCache = false;
    const wasm = env.backends.onnx.wasm;
    if (wasm !== undefined) {
      wasm.wasmPaths = { mjs: ortFactoryUrl, wasm: ortWasmUrl };
      wasm.numThreads = 1;
      wasm.proxy = false;
    }
    const transcriber = await pipeline('automatic-speech-recognition', model, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (info) => {
        if (info.status === 'progress_total') onProgress(info.progress / PERCENT);
      },
    });
    return transcriber as unknown as Transcriber;
  },
};

const handle = createWhisperHandler(
  runtime,
  (message) => scope.postMessage(message),
  () => performance.now(),
);
scope.onmessage = (event) => void handle(event.data);
