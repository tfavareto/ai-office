import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICE_MODEL_SIZES, type VoiceModelSize } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { specBytes, VOICE_MODEL_SPECS } from './manifest';
import { HUGGING_FACE_SOURCE } from './source';

const PRIVACY_DOC = join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/05-privacy-and-security.md');
const JSON_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
];
/** The ONNX files transformers.js asks for with the dtype the worker uses for each model. */
const WASM_Q8 = ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const WEBGPU_FP16_Q4 = ['onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged_q4.onnx'];
const EXPECTED: Readonly<Record<VoiceModelSize, { repo: string; onnx: readonly string[] }>> = {
  tiny: { repo: 'Xenova/whisper-tiny', onnx: WASM_Q8 },
  base: { repo: 'Xenova/whisper-base', onnx: WASM_Q8 },
  small: { repo: 'Xenova/whisper-small', onnx: WASM_Q8 },
  turbo: { repo: 'onnx-community/whisper-large-v3-turbo', onnx: WEBGPU_FP16_Q4 },
};

describe('pinned speech models', () => {
  it.each(VOICE_MODEL_SIZES)('pins %s to a full commit and lists every file with a SHA-256', (size) => {
    const spec = VOICE_MODEL_SPECS[size];

    expect(spec.repo).toBe(EXPECTED[size].repo);
    expect(spec.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(spec.files.map((file) => file.path)).toEqual([...JSON_FILES, ...EXPECTED[size].onnx]);
    for (const file of spec.files) {
      expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/);
      expect(file.bytes, file.path).toBeGreaterThan(0);
    }
  });

  it('keeps the sizes the interface promises', () => {
    const megabytes = VOICE_MODEL_SIZES.map((size) => Math.round(specBytes(VOICE_MODEL_SPECS[size]) / 1e6));

    expect(megabytes).toEqual([44, 80, 252, 1611]);
  });

  it('only ever points at Hugging Face over HTTPS, at the pinned commit', () => {
    const spec = VOICE_MODEL_SPECS.base;
    const url = HUGGING_FACE_SOURCE.fileUrl(spec, 'onnx/encoder_model_quantized.onnx');

    expect(url.href).toBe(
      `https://huggingface.co/Xenova/whisper-base/resolve/${spec.revision}/onnx/encoder_model_quantized.onnx`,
    );
    expect(HUGGING_FACE_SOURCE.allows(url)).toBe(true);
  });

  it.each([
    'https://us.aws.cdn.hf.co/xet-bridge-us/abc',
    'https://cdn-lfs.huggingface.co/x',
    'https://huggingface.co/a',
  ])('allows %s', (address) => {
    expect(HUGGING_FACE_SOURCE.allows(new URL(address))).toBe(true);
  });

  it.each([
    'http://huggingface.co/a',
    'https://huggingface.co.evil.example/a',
    'https://evilhuggingface.co/a',
    'https://evil-hf.co/a',
    'https://user:pw@huggingface.co/a',
    'https://huggingface.co:8443/a',
    'https://127.0.0.1/a',
    'file:///etc/passwd',
    'https://example.com/a',
  ])('refuses %s', (address) => {
    expect(HUGGING_FACE_SOURCE.allows(new URL(address))).toBe(false);
  });

  it('is described by the privacy page: same commits, sizes and hashes', async () => {
    const doc = await readFile(PRIVACY_DOC, 'utf8');

    for (const size of VOICE_MODEL_SIZES) {
      const spec = VOICE_MODEL_SPECS[size];
      expect(doc, `${size} repo`).toContain(`\`${spec.repo}\` at commit \`${spec.revision}\``);
      for (const file of spec.files)
        expect(doc, `${size} ${file.path}`).toContain(`| \`${file.path}\` | ${file.bytes} | \`${file.sha256}\` |`);
    }
  });
});
