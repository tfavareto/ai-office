import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectVoiceCapabilities } from './browser';

function stubBrowser(options: { isolated: boolean; cores: number; gpu?: { requestAdapter: () => Promise<unknown> } }) {
  vi.stubGlobal('crossOriginIsolated', options.isolated);
  vi.stubGlobal('navigator', { hardwareConcurrency: options.cores, gpu: options.gpu });
}

const adapterWith = (...features: string[]) => ({
  requestAdapter: () => Promise.resolve({ features: new Set(features) }),
});

afterEach(() => vi.unstubAllGlobals());

describe('detectVoiceCapabilities', () => {
  it('finds WebGPU with 16-bit shaders and the threads of an isolated page', async () => {
    stubBrowser({ isolated: true, cores: 8, gpu: adapterWith('shader-f16') });

    expect(await detectVoiceCapabilities()).toEqual({ webgpu: true, threads: 4 });
  });

  it('does not count WebGPU without 16-bit shaders, nor one that has no adapter or fails', async () => {
    stubBrowser({ isolated: true, cores: 8, gpu: adapterWith('timestamp-query') });
    expect((await detectVoiceCapabilities()).webgpu).toBe(false);

    stubBrowser({ isolated: true, cores: 8, gpu: { requestAdapter: () => Promise.resolve(null) } });
    expect((await detectVoiceCapabilities()).webgpu).toBe(false);

    stubBrowser({ isolated: true, cores: 8, gpu: { requestAdapter: () => Promise.reject(new Error('lost')) } });
    expect((await detectVoiceCapabilities()).webgpu).toBe(false);
  });

  it('uses one thread on a page that is not cross-origin isolated, and without WebGPU at all', async () => {
    stubBrowser({ isolated: false, cores: 8 });

    expect(await detectVoiceCapabilities()).toEqual({ webgpu: false, threads: 1 });
  });
});
