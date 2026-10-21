import { describe, expect, test } from 'vitest';
import { LOCALES, type Locale, type Msg, type MsgParam } from '../i18n';
import { SHARED_CATALOGS, translateShared } from '../index';

const KEYS = Object.keys(SHARED_CATALOGS['pt-BR']);
/** Keys whose text is the same in every language (placeholders, symbols, unit abbreviations). */
const LANGUAGE_NEUTRAL = new Set([
  'activity.bash.run',
  'activity.mcp',
  'duration.seconds',
  'duration.minutes',
  'duration.hours',
]);
const NUMERIC_PARAMS = new Set(['s', 'm', 'h', 'n']);

function paramNames(template: string): string[] {
  return [...new Set([...template.matchAll(/\{(\w+)\s*[,}]/g)].map((match) => match[1] as string))].sort();
}

/** Representative parameters for a template: numbers for time parts, a known option for selects, else sample text. */
function sampleParams(template: string): Record<string, MsgParam> {
  const params: Record<string, MsgParam> = {};
  for (const name of paramNames(template)) {
    if (name === 'scope') params[name] = 'session';
    else params[name] = NUMERIC_PARAMS.has(name) ? 7 : `sample-${name}`;
  }
  return params;
}

function render(locale: Locale, key: string): string {
  const template = SHARED_CATALOGS['pt-BR'][key] as string;
  return translateShared(locale, { key, params: sampleParams(template) } satisfies Msg);
}

describe('shared catalogs', () => {
  test('en and es define exactly the pt-BR keys', () => {
    for (const locale of LOCALES) expect(Object.keys(SHARED_CATALOGS[locale]).sort()).toEqual([...KEYS].sort());
  });

  test('every locale keeps the placeholders of the pt-BR text', () => {
    for (const key of KEYS) {
      const expected = paramNames(SHARED_CATALOGS['pt-BR'][key] as string);
      for (const locale of LOCALES)
        expect([key, locale, paramNames(SHARED_CATALOGS[locale][key] as string)]).toEqual([key, locale, expected]);
    }
  });

  test.each(KEYS)('%s renders in en and es without leaking the key or a placeholder', (key) => {
    for (const locale of LOCALES) {
      const text = render(locale, key);
      expect(text, `${locale} ${key}`).not.toBe(key);
      expect(text, `${locale} ${key}`).not.toMatch(/[{}]/);
      expect(text.trim().length, `${locale} ${key}`).toBeGreaterThan(0);
      for (const value of Object.values(sampleParams(SHARED_CATALOGS['pt-BR'][key] as string))) {
        if (typeof value === 'string' && value !== 'session') expect(text, `${locale} ${key}`).toContain(value);
      }
    }
  });

  test('English is translated, not a copy of the Portuguese text, for every language-specific key', () => {
    const untranslated = KEYS.filter(
      (key) => !LANGUAGE_NEUTRAL.has(key) && SHARED_CATALOGS.en[key] === SHARED_CATALOGS['pt-BR'][key],
    );
    expect(untranslated).toEqual([]);
  });

  test('an unknown key falls back to the key itself (and a given fallback text wins)', () => {
    expect(translateShared('en', { key: 'no.such.key' })).toBe('no.such.key');
    expect(translateShared('es', { key: 'no.such.key' }, 'texto')).toBe('texto');
  });

  test('the permission scope select renders each destination in every language', () => {
    const scopes: [string, string, string, string][] = [
      ['session', ' nesta sessão', ' for this session', ' en esta sesión'],
      ['project', ' neste projeto', ' for this project', ' en este proyecto'],
      ['user', ' sempre', ' always', ' siempre'],
      ['none', '', '', ''],
    ];
    for (const [scope, pt, en, es] of scopes) {
      const message: Msg = { key: 'perm.suggestion.remember', params: { scope } };
      expect(translateShared('pt-BR', message)).toBe(`Lembrar esta decisão${pt}`);
      expect(translateShared('en', message)).toBe(`Remember this decision${en}`);
      expect(translateShared('es', message)).toBe(`Recordar esta decisión${es}`);
    }
  });
});
