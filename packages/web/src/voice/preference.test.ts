import { describe, expect, it, vi } from 'vitest';
import { createVoicePreference, readVoiceSize, VOICE_PREF_KEY, type StorageLike } from './preference';

function memory(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => void (data[key] = value),
  };
}

describe('voice size preference', () => {
  it('defaults to the most accurate model, in the language of the interface', () => {
    expect(createVoicePreference(memory()).size()).toBe('turbo');
    expect(createVoicePreference(null).size()).toBe('turbo');
    expect(createVoicePreference(null).language()).toBe('interface');
  });

  it('keeps the size someone picked before the large model existed', () => {
    expect(createVoicePreference(memory({ [VOICE_PREF_KEY]: '{"size":"base"}' })).size()).toBe('base');
  });

  it('remembers the language choice next to the size', () => {
    const storage = memory();
    const pref = createVoicePreference(storage);
    const listener = vi.fn();
    pref.onChange(listener);

    pref.setLanguage('auto');
    pref.setLanguage('auto');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.data[VOICE_PREF_KEY] ?? '{}')).toEqual({ size: 'turbo', language: 'auto' });
    expect(createVoicePreference(storage).language()).toBe('auto');
    expect(createVoicePreference(memory({ [VOICE_PREF_KEY]: '{"language":"klingon"}' })).language()).toBe('interface');
  });

  it('remembers the choice across page loads and tells listeners', () => {
    const storage = memory();
    const pref = createVoicePreference(storage);
    const listener = vi.fn();
    pref.onChange(listener);

    pref.setSize('small');
    pref.setSize('small');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(createVoicePreference(storage).size()).toBe('small');
  });

  it.each([[''], ['not json'], ['{"size":"huge"}'], ['null'], ['[1]'], ['{"size":3}']])(
    'falls back to the default for %j',
    (stored) => {
      expect(readVoiceSize(memory({ [VOICE_PREF_KEY]: stored }))).toBe('turbo');
    },
  );

  it('keeps working in memory when the storage refuses to save', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    const pref = createVoicePreference(storage);

    pref.setSize('tiny');

    expect(pref.size()).toBe('tiny');
  });
});
