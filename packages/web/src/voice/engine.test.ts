import { describe, expect, it, vi } from 'vitest';
import { activeVoiceModel, createVoiceEngine, needsWebGpu, wasmThreads } from './engine';

describe('wasmThreads', () => {
  it('uses one core less than the machine has, at most four, and one when the page is not isolated', () => {
    expect(wasmThreads(true, 6)).toBe(4);
    expect(wasmThreads(true, 4)).toBe(3);
    expect(wasmThreads(true, 2)).toBe(1);
    expect(wasmThreads(true, 1)).toBe(1);
    expect(wasmThreads(false, 16)).toBe(1);
    expect(wasmThreads(true, Number.NaN)).toBe(1);
  });
});

describe('activeVoiceModel', () => {
  it('runs large-v3-turbo on the graphics card when there is WebGPU', () => {
    expect(activeVoiceModel('turbo', { webgpu: true, threads: 4 })).toEqual({
      size: 'turbo',
      device: 'webgpu',
      backend: 'webgpu',
      threads: 4,
    });
  });

  it('uses small on the CPU in its place without WebGPU, and says so', () => {
    expect(activeVoiceModel('turbo', { webgpu: false, threads: 4 })).toEqual({
      size: 'small',
      device: 'wasm',
      backend: 'wasm-threads',
      threads: 4,
      fallbackFrom: 'turbo',
    });
  });

  it('runs the lighter models on the CPU, threaded when it can', () => {
    expect(activeVoiceModel('base', { webgpu: true, threads: 3 })).toMatchObject({
      size: 'base',
      backend: 'wasm-threads',
    });
    expect(activeVoiceModel('tiny', { webgpu: false, threads: 1 })).toMatchObject({ size: 'tiny', backend: 'wasm' });
    expect(needsWebGpu('small')).toBe(false);
  });
});

describe('createVoiceEngine', () => {
  it('checks the browser once and tells listeners', async () => {
    const detect = vi.fn(() => Promise.resolve({ webgpu: true, threads: 2 }));
    const engine = createVoiceEngine(detect);
    const listener = vi.fn();
    engine.onChange(listener);

    expect(engine.capabilities()).toBeUndefined();
    await Promise.all([engine.ready(), engine.ready()]);

    expect(detect).toHaveBeenCalledTimes(1);
    expect(engine.capabilities()).toEqual({ webgpu: true, threads: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats a failed check as no WebGPU and one thread', async () => {
    const engine = createVoiceEngine(() => Promise.reject(new Error('no gpu')));

    expect(await engine.ready()).toEqual({ webgpu: false, threads: 1 });
  });

  it('keeps a copy of the last take', () => {
    const engine = createVoiceEngine(() => Promise.resolve({ webgpu: false, threads: 1 }));
    const timing = { size: 'base' as const, backend: 'wasm' as const, audioMs: 3000, ms: 800 };

    engine.recordTake(timing);
    timing.ms = 1;

    expect(engine.lastTake()).toEqual({ size: 'base', backend: 'wasm', audioMs: 3000, ms: 800 });
  });
});
