// The Whisper models voice input can download: where from, which exact revision and the SHA-256 of every file.
//
// Source: the ONNX conversions used by transformers.js, published on Hugging Face by its maintainer (`Xenova/whisper-*`).
// Weights: OpenAI Whisper (MIT license); the Hugging Face model cards list Apache-2.0. Both are permissive licenses.
// Files: the 8-bit quantized encoder and merged decoder (what transformers.js picks for the WASM backend) and the small
// JSON files the library reads next to them. Every revision below is a full commit hash, so the bytes cannot change
// under us; a download is refused unless each file has exactly this size and SHA-256.
//
// To update a model: pick the new commit, regenerate the list (size and SHA-256 of each file at that commit), change
// this file and the tables in docs/05-privacy-and-security.md together (a test compares them).
import type { VoiceModelSize } from '@ai-office/shared';

export interface VoiceModelFile {
  /** Path inside the repository and inside the model folder, with `/` separators. */
  path: string;
  bytes: number;
  sha256: string;
}

export interface VoiceModelSpec {
  /** Hugging Face repository, `owner/name`. */
  repo: string;
  /** Full commit hash the files are pinned to. */
  revision: string;
  /** License named by the repository's model card. */
  license: string;
  files: readonly VoiceModelFile[];
}

export const VOICE_MODEL_SPECS: Readonly<Record<VoiceModelSize, VoiceModelSpec>> = {
  tiny: {
    repo: 'Xenova/whisper-tiny',
    revision: '5332fcc35e32a33b86612b9a57a89be7906102b1',
    license: 'apache-2.0',
    files: [
      { path: 'config.json', bytes: 2248, sha256: '2b2e4e519084e0ea028b19b153f95202735a971870d6844aa26e559edd292e94' },
      {
        path: 'generation_config.json',
        bytes: 3716,
        sha256: '68ac791fcb4999461a313472125042934656240ba1cba7d1c2627fcbb19ac24c',
      },
      {
        path: 'preprocessor_config.json',
        bytes: 339,
        sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
      },
      {
        path: 'tokenizer.json',
        bytes: 2480466,
        sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566',
      },
      {
        path: 'tokenizer_config.json',
        bytes: 282683,
        sha256: '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce',
      },
      {
        path: 'onnx/encoder_model_quantized.onnx',
        bytes: 10124910,
        sha256: 'fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e',
      },
      {
        path: 'onnx/decoder_model_merged_quantized.onnx',
        bytes: 30727765,
        sha256: '6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0',
      },
    ],
  },
  base: {
    repo: 'Xenova/whisper-base',
    revision: '64da57285918e20ea79ea5c88eed7197933abaa8',
    license: 'apache-2.0',
    files: [
      { path: 'config.json', bytes: 2248, sha256: 'd1d347fdb422e6347c2f843a90d375aa67ea3f4b3e20d2c3075f9a9f6243685b' },
      {
        path: 'generation_config.json',
        bytes: 3776,
        sha256: '3bba359e33fdd6dc1c10f71846a477d339b0242f462f70ea1dd73274caa38d05',
      },
      {
        path: 'preprocessor_config.json',
        bytes: 339,
        sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
      },
      {
        path: 'tokenizer.json',
        bytes: 2480466,
        sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566',
      },
      {
        path: 'tokenizer_config.json',
        bytes: 282683,
        sha256: '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce',
      },
      {
        path: 'onnx/encoder_model_quantized.onnx',
        bytes: 23200850,
        sha256: '3e345e977b55620a37c0c2b2af0644e019afdfad562dcf71eb929bb7274285f9',
      },
      {
        path: 'onnx/decoder_model_merged_quantized.onnx',
        bytes: 53707539,
        sha256: 'a6beb6baabb66f00b6a686d828c95ffca6146d51900cbad0266cad38f64cf861',
      },
    ],
  },
  small: {
    repo: 'Xenova/whisper-small',
    revision: '2d67713f236afa48a18992566e7647f6ca848e13',
    license: 'apache-2.0',
    files: [
      { path: 'config.json', bytes: 2232, sha256: '5a6429d21d7a3379dd0861b74510f9f7076f32b563bffc9fcb072482d55ab3be' },
      {
        path: 'generation_config.json',
        bytes: 3837,
        sha256: '0b7407a4e53a677f826e03c75d409e6f830663932bf43dda3b08c5efa2223279',
      },
      {
        path: 'preprocessor_config.json',
        bytes: 339,
        sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
      },
      {
        path: 'tokenizer.json',
        bytes: 2480466,
        sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566',
      },
      {
        path: 'tokenizer_config.json',
        bytes: 282683,
        sha256: '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce',
      },
      {
        path: 'onnx/encoder_model_quantized.onnx',
        bytes: 92324809,
        sha256: '969f5ac12974340386bf7a02ea6626003e5e2dee396ffc6ab0eec282bf55ba06',
      },
      {
        path: 'onnx/decoder_model_merged_quantized.onnx',
        bytes: 156780950,
        sha256: 'fcfc6100dc7339e7507e10f8b274350be7c4f8d8b575f0293f94cc0e156d6d24',
      },
    ],
  },
};

/** Total download size of a model, in bytes. */
export function specBytes(spec: VoiceModelSpec): number {
  return spec.files.reduce((total, file) => total + file.bytes, 0);
}
