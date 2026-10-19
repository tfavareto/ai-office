import { describe, expect, test } from 'vitest';
import { createTranslator, formatMessage, isLocale, resolveLocale } from './i18n';

describe('resolveLocale', () => {
  test('maps Portuguese tags to pt-BR, Spanish to es and everything else to en', () => {
    expect(resolveLocale(['pt-PT'])).toBe('pt-BR');
    expect(resolveLocale(['pt'])).toBe('pt-BR');
    expect(resolveLocale(['es-MX', 'en'])).toBe('es');
    expect(resolveLocale(['fr-FR', 'es'])).toBe('es');
    expect(resolveLocale(['de-DE'])).toBe('en');
    expect(resolveLocale([])).toBe('en');
  });
});

describe('isLocale', () => {
  test('accepts only the supported locales', () => {
    expect(isLocale('pt-BR')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('es')).toBe(true);
    expect(isLocale('pt')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe('formatMessage', () => {
  test('replaces named placeholders and leaves unknown ones visible', () => {
    expect(formatMessage('en', 'Editing {file}', { file: 'App.tsx' })).toBe('Editing App.tsx');
    expect(formatMessage('en', 'Hi {who}', {})).toBe('Hi {who}');
  });

  test('formats numbers with the locale', () => {
    expect(formatMessage('pt-BR', '{n} linhas', { n: 1234 })).toBe('1.234 linhas');
    expect(formatMessage('en', '{n} lines', { n: 1234 })).toBe('1,234 lines');
  });

  test('selects plural forms with Intl.PluralRules and # as the number', () => {
    const template = '{count, plural, one {# agente} other {# agentes}}';
    expect(formatMessage('pt-BR', template, { count: 1 })).toBe('1 agente');
    expect(formatMessage('pt-BR', template, { count: 3 })).toBe('3 agentes');
    expect(formatMessage('en', '{count, plural, =0 {no rooms} one {# room} other {# rooms}}', { count: 0 })).toBe('no rooms');
  });

  test('supports select on a string parameter', () => {
    const template = '{side, select, north {Norte} other {Sul}}';
    expect(formatMessage('pt-BR', template, { side: 'north' })).toBe('Norte');
    expect(formatMessage('pt-BR', template, { side: 'x' })).toBe('Sul');
  });
});

describe('createTranslator', () => {
  const catalogs = {
    'pt-BR': { hello: 'Olá, {name}', onlyPt: 'Só em português' },
    en: { hello: 'Hello, {name}' },
    es: { hello: 'Hola, {name}' },
  };

  test('translates a message in the requested locale', () => {
    const t = createTranslator(catalogs);
    expect(t('es', { key: 'hello', params: { name: 'Ana' } })).toBe('Hola, Ana');
  });

  test('falls back to English, then pt-BR, then the fallback text, then the key', () => {
    const t = createTranslator(catalogs);
    expect(t('es', { key: 'onlyPt' })).toBe('Só em português');
    expect(t('en', { key: 'missing' }, 'texto original')).toBe('texto original');
    expect(t('en', { key: 'missing' })).toBe('missing');
  });

  test('translates nested message parameters', () => {
    const t = createTranslator({ 'pt-BR': {}, en: { wrap: 'Asking: {inner}', inner: 'run {cmd}' }, es: {} });
    expect(t('en', { key: 'wrap', params: { inner: { key: 'inner', params: { cmd: 'npm test' } } } })).toBe('Asking: run npm test');
  });
});
