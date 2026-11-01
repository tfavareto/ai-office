import { formatMessage, type Locale } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { proEn } from './pro-en';
import { proEs } from './pro-es';
import { proPtBR, type ProKey } from './pro-pt-BR';

const CATALOGS: Readonly<Record<Locale, Readonly<Record<ProKey, string>>>> = {
  'pt-BR': proPtBR,
  en: proEn,
  es: proEs,
};

/** Names of the arguments of a template (plain and plural). */
function argumentsOf(template: string): string[] {
  return [...template.matchAll(/\{\s*([A-Za-z][A-Za-z0-9]*)\s*[,}]/g)].map((match) => match[1] as string);
}

function render(locale: Locale, template: string, value: number): string {
  const params = Object.fromEntries(argumentsOf(template).map((name) => [name, value]));
  return formatMessage(locale, template, params).replace(/\d+/g, 'N');
}

describe('Pro view plurals', () => {
  it('words one and many differently in every language', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS) as [Locale, Readonly<Record<ProKey, string>>][])
      for (const [key, template] of Object.entries(catalog)) {
        if (!template.includes(', plural,')) continue;
        expect(render(locale, template, 1), `${locale} ${key}`).not.toBe(render(locale, template, 2));
      }
  });

  it('says how many subagents finished in proper English', () => {
    expect(formatMessage('en', proEn['pro.node.done'], { n: 1 })).toBe('1 finished subagent');
    expect(formatMessage('en', proEn['pro.node.done'], { n: 3 })).toBe('3 finished subagents');
  });
});
