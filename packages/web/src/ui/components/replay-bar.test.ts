import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import type { Marker } from '../../timelapse/markers';
import { describeMarker } from './replay-bar';

const marker = (over: Partial<Marker>): Marker => ({ at: 0, kind: 'commit', project: 'loja', count: 1, ...over });

describe('describeMarker', () => {
  afterEach(() => setLocale('pt-BR'));

  it('says what happened, who did it and where, in the language of the interface', () => {
    const commit = marker({ agent: 'Ana', detail: 'feat: cupom' });

    setLocale('pt-BR');
    expect(describeMarker(commit)).toBe('Commit de Ana em loja: feat: cupom');
    setLocale('en');
    expect(describeMarker(commit)).toBe('Commit by Ana in loja: feat: cupom');
    setLocale('es');
    expect(describeMarker(commit)).toBe('Commit de Ana en loja: feat: cupom');
  });

  it('has a form for a commit nobody in the office made', () => {
    setLocale('en');

    expect(describeMarker(marker({ detail: 'by hand' }))).toBe('Commit in loja: by hand');
  });

  it('describes failed tests, waits (with how long) and arrivals', () => {
    setLocale('en');

    expect(describeMarker(marker({ kind: 'test-failed', agent: 'Bia', detail: 'vitest' }))).toBe(
      'Tests failed (vitest): Bia in loja',
    );
    expect(describeMarker(marker({ kind: 'wait', agent: 'Bia', detail: 'Edit', durationMs: 150_000 }))).toBe(
      'Bia waited 2 min for you (Edit) in loja',
    );
    expect(describeMarker(marker({ kind: 'arrival', agent: 'Caio' }))).toBe('Caio arrived in loja');
  });
});
