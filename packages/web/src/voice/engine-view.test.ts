import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { activeVoiceModel } from './engine';
import { engineView } from './engine-view';

beforeEach(() => setLocale('en'));

describe('engineView', () => {
  it('says the browser is being checked before it knows', () => {
    expect(engineView(undefined, undefined)).toEqual({ engine: 'Checking where the model can run…' });
  });

  it('names the graphics card and what to expect from it', () => {
    const view = engineView(activeVoiceModel('turbo', { webgpu: true, threads: 4 }), undefined);

    expect(view.engine).toBe('Engine: graphics card (WebGPU)');
    expect(view.speed).toContain('graphics card');
    expect(view.fallback).toBeUndefined();
  });

  it('explains which model stands in for large-v3-turbo without WebGPU', () => {
    const view = engineView(activeVoiceModel('turbo', { webgpu: false, threads: 3 }), undefined);

    expect(view.engine).toBe('Engine: processor, 3 threads (WebAssembly)');
    expect(view.fallback).toBe(
      'This browser does not offer 16-bit WebGPU, which the Best model needs: voice uses the Accurate model instead.',
    );
  });

  it('warns that one thread is slow', () => {
    const view = engineView(activeVoiceModel('base', { webgpu: false, threads: 1 }), undefined);

    expect(view.engine).toBe('Engine: processor, 1 thread (WebAssembly)');
    expect(view.speed).toBe('With a single thread, transcribing takes much longer.');
  });

  it('tells how long the last take took, only when it ran on the model shown', () => {
    const model = activeVoiceModel('turbo', { webgpu: true, threads: 4 });
    const take = { size: 'turbo' as const, backend: 'webgpu' as const, audioMs: 7_000, ms: 1_450 };

    expect(engineView(model, take).last).toBe('Last transcription: 7 s of speech in 1.5 s.');
    expect(engineView(model, { ...take, size: 'base', backend: 'wasm-threads' }).last).toBeUndefined();
    setLocale('pt-BR');
    expect(engineView(model, take).last).toBe('Última transcrição: 7 s de fala em 1,5 s.');
  });
});
