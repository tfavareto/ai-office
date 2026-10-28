import { describe, expect, it } from 'vitest';
import { micView } from './mic';

describe('micView', () => {
  it('is disabled with an explanation when the build has no voice input', () => {
    // Arrange, Act
    const view = micView(false, { state: 'unavailable' }, false);

    // Assert
    expect(view).toMatchObject({ label: 'pro.voice.label', hint: 'pro.voice.unavailable', disabled: true });
  });

  it('walks through prepare, progress, record and stop', () => {
    // Arrange, Act, Assert
    expect(micView(true, { state: 'off' }, false)).toMatchObject({ label: 'pro.voice.prepare', disabled: false });
    expect(micView(true, { state: 'downloading', progress: 0.42 }, false)).toMatchObject({
      label: 'pro.voice.downloading',
      percent: 42,
      disabled: true,
      busy: true,
    });
    expect(micView(true, { state: 'ready' }, false)).toMatchObject({ label: 'pro.voice.start', disabled: false });
    expect(micView(true, { state: 'listening' }, true)).toMatchObject({ label: 'pro.voice.stop', listening: true });
  });

  it('lets only the prompt that started a dictation stop it', () => {
    // Arrange, Act
    const other = micView(true, { state: 'listening' }, false);

    // Assert
    expect(other).toMatchObject({ hint: 'pro.voice.elsewhere', disabled: true, listening: false });
  });

  it('keeps the engine reason of an error', () => {
    // Arrange, Act
    const view = micView(true, { state: 'error', errorKey: 'voice.error.mic' }, false);

    // Assert
    expect(view).toMatchObject({ label: 'pro.voice.retry', errorKey: 'voice.error.mic', disabled: false });
  });
});
