import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { formatMegabytes, micView, percentOf, sizeOptionLabel, voiceErrorText } from './mic-view';

afterEach(() => setLocale('pt-BR'));

describe('micView', () => {
  it('asks for the download, with its size and the privacy promise, when there is no model', () => {
    setLocale('en');

    const view = micView({ state: 'off' }, 79_677_901);

    expect(view).toMatchObject({
      kind: 'download',
      actionLabel: 'Download voice model (80 MB)',
      text: 'Audio is transcribed on this computer and is never sent anywhere.',
      disabled: false,
    });
  });

  it('asks for the download without a size when the size is not known yet', () => {
    setLocale('en');

    expect(micView({ state: 'off' }).actionLabel).toBe('Download voice model');
  });

  it('shows the download and the loading as progress, with a percentage', () => {
    setLocale('en');

    expect(micView({ state: 'downloading', progress: 0.424 })).toMatchObject({
      kind: 'progress',
      text: 'Downloading the voice model… 42%',
      progress: 0.424,
      disabled: true,
    });
    expect(micView({ state: 'loading', progress: 1 })).toMatchObject({ text: 'Loading the model… 100%' });
    expect(micView({ state: 'loading' })).toMatchObject({ progress: 0, text: 'Loading the model… 0%' });
  });

  it('offers to record when ready', () => {
    setLocale('es');

    expect(micView({ state: 'ready' })).toMatchObject({ kind: 'record', icon: 'mic', actionLabel: 'Grabar por voz' });
  });

  it('shows the time and the level while listening, and can be cancelled', () => {
    setLocale('en');

    const view = micView({ state: 'listening', elapsedMs: 7400, level: 0.35, limitMs: 60_000 });

    expect(view).toMatchObject({
      kind: 'listening',
      icon: 'stop',
      actionLabel: 'Stop and transcribe',
      text: 'Listening… 0:07',
      meter: 0.35,
      cancellable: true,
    });
  });

  it('says when the take reached its limit', () => {
    setLocale('en');

    const view = micView({ state: 'listening', elapsedMs: 60_000, limitMs: 60_000, limitReached: true, level: 0 });

    expect(view.text).toBe('Reached the 60 s limit. Press stop to transcribe.');
  });

  it('shows a spinner state while transcribing, and the take can still be cancelled', () => {
    setLocale('pt-BR');

    expect(micView({ state: 'transcribing' })).toMatchObject({
      kind: 'working',
      text: 'Transcrevendo…',
      disabled: true,
      cancellable: true,
    });
  });

  it('explains an unavailable voice input and disables the button', () => {
    setLocale('en');

    const view = micView({ state: 'unavailable', errorKey: 'voice.error.unsupported' });

    expect(view.kind).toBe('unavailable');
    expect(view.disabled).toBe(true);
    expect(view.text).toContain('microphone');
  });

  it.each([
    ['voice.error.denied', 'start'],
    ['voice.error.mic', 'start'],
    ['voice.error.transcribe', 'start'],
    ['voice.error.downloadNetwork', 'prepare'],
    ['voice.error.downloadIntegrity', 'prepare'],
    ['voice.error.load', 'prepare'],
  ] as const)('after %s, retrying means %s', (errorKey, retry) => {
    expect(micView({ state: 'error', errorKey })).toMatchObject({ kind: 'error', retry });
  });
});

describe('helpers', () => {
  it('names a size in megabytes, at least one, and in gigabytes from one up', () => {
    setLocale('en');

    expect(formatMegabytes(251_875_316)).toBe('252 MB');
    expect(formatMegabytes(200)).toBe('1 MB');
    expect(formatMegabytes(1_611_258_854)).toBe('1.6 GB');
    setLocale('pt-BR');
    expect(formatMegabytes(1_611_258_854)).toBe('1,6 GB');
  });

  it('turns an error key into a sentence, with a fallback for unknown keys', () => {
    setLocale('en');

    expect(voiceErrorText('voice.error.noDevice')).toBe('No microphone was found.');
    expect(voiceErrorText('something.else')).toBe('The microphone could not be used.');
    expect(voiceErrorText(undefined)).toBe('The microphone could not be used.');
  });

  it('clamps the percentage', () => {
    expect([percentOf(undefined), percentOf(-1), percentOf(0.5), percentOf(7)]).toEqual([0, 0, 50, 100]);
  });

  it('labels a size with its name and download', () => {
    setLocale('en');

    expect(sizeOptionLabel('base', 79_677_901)).toBe('Balanced · 80 MB');
    expect(sizeOptionLabel('tiny', undefined)).toBe('Fast');
  });
});
