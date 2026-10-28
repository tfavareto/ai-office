// The Whisper worker: transformers.js runs here, off the main thread, on WebGPU (large-v3-turbo) or WebAssembly (tiny,
// base, small; several threads when the page is cross-origin isolated). It only ever reads the model from this server
// (`allowRemoteModels = false`), and the two ONNX Runtime builds it may need are files of this build, fetched only by
// this worker: the WebGPU one (asyncify) and the plain WebAssembly one.
import { env, pipeline } from '@huggingface/transformers';
import ortWebGpuFactoryUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWebGpuWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
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
  async load(request, dtype, onProgress) {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = request.baseUrl;
    // The files come from AI Office on every load; the browser keeps no second copy of the model.
    env.useBrowserCache = false;
    env.useWasmCache = false;
    const wasm = env.backends.onnx.wasm;
    if (wasm !== undefined) {
      wasm.wasmPaths =
        request.device === 'webgpu'
          ? { mjs: ortWebGpuFactoryUrl, wasm: ortWebGpuWasmUrl }
          : { mjs: ortFactoryUrl, wasm: ortWasmUrl };
      wasm.numThreads = request.threads;
      wasm.proxy = false;
    }
    const transcriber = await pipeline('automatic-speech-recognition', request.model, {
      device: request.device,
      dtype,
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
