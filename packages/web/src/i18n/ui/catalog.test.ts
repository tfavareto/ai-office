import { LOCALES, SHARED_CATALOGS, type Locale } from '@ai-office/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, t, type TextKey } from '..';
import { WORLD_CATALOGS } from '../world';
import { UI_CATALOGS, type UiKey } from '.';
import { uiPtBR } from './pt-BR';

/** Source of every non-test module of the app (catalogs excluded), to look for the keys in use. */
const SOURCES = import.meta.glob(['/src/**/*.ts', '!/src/**/*.test.ts', '!/src/i18n/ui/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const keys = Object.keys(uiPtBR) as UiKey[];

/** Names used by `{name}`, `{name, plural, …}` and `{name, select, …}` in a template. */
function placeholders(template: string): string[] {
  const names = new Set<string>();
  const withoutOptions = template.replace(/(?:=\d+|zero|one|two|few|many|other)\s*\{[^{}]*\}/g, ' ');
  for (const match of withoutOptions.matchAll(/\{\s*([A-Za-z][A-Za-z0-9]*)\s*[,}]/g)) names.add(match[1] as string);
  return [...names].sort();
}

describe('ui catalogs', () => {
  afterEach(() => setLocale('pt-BR'));

  it('defines the same keys in every language', () => {
    for (const locale of LOCALES) expect(Object.keys(UI_CATALOGS[locale]).sort(), locale).toEqual([...keys].sort());
  });

  it('never leaves a text empty or equal to its key in English and Spanish', () => {
    for (const locale of ['en', 'es'] as const) {
      for (const key of keys) {
        const value = UI_CATALOGS[locale][key] ?? '';
        expect(value.trim().length, `${locale} ${key}`).toBeGreaterThan(0);
        expect(value, `${locale} ${key}`).not.toBe(key);
      }
    }
  });

  it('uses the same placeholders in every language', () => {
    for (const key of keys) {
      const expected = placeholders(uiPtBR[key]);
      for (const locale of ['en', 'es'] as const) expect(placeholders(UI_CATALOGS[locale][key] ?? ''), `${locale} ${key}`).toEqual(expected);
    }
  });

  it('renders every key in every language without leftovers', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const key of keys) {
        const params = Object.fromEntries(placeholders(uiPtBR[key]).map((name) => [name, 3]));
        const text = t(key, params);
        expect(text, `${locale} ${key}`).not.toBe(key);
        expect(text, `${locale} ${key}`).not.toMatch(/[{}]/);
      }
    }
  });

  it('does not shadow the shared or world catalogs', () => {
    for (const locale of LOCALES as readonly Locale[]) {
      const others = new Set([...Object.keys(SHARED_CATALOGS[locale]), ...Object.keys(WORLD_CATALOGS[locale])]);
      expect(keys.filter((key) => others.has(key)), locale).toEqual([]);
    }
  });

  it('has no unused keys', () => {
    const source = Object.values(SOURCES).join('\n');
    expect(source.length).toBeGreaterThan(0);
    const dynamicPrefixes = [...source.matchAll(/`([a-z][A-Za-z0-9.]*\.)\$\{/g)].map((match) => match[1] as string);
    const unused = keys.filter((key) => !source.includes(`'${key}'`) && !dynamicPrefixes.some((prefix) => key.startsWith(prefix)));
    expect(unused).toEqual([]);
  });

  it('picks plural forms per language', () => {
    const count = (n: number): string => t('topbar.counter.agents' satisfies TextKey, { n });
    expect([count(0), count(1), count(2)]).toEqual(['agentes', 'agente', 'agentes']);
    setLocale('en');
    expect([count(0), count(1), count(2)]).toEqual(['agents', 'agent', 'agents']);
    expect(t('hover.room.people', { n: 1 })).toBe('1 person in the room');
    expect(t('hover.room.people', { n: 4 })).toBe('4 people in the room');
    setLocale('es');
    expect(t('hover.room.people', { n: 2 })).toBe('2 personas en la sala');
  });
});
