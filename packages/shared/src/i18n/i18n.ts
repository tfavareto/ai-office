// Localization core shared by the server (which emits message keys) and the web app (which renders them).
// Messages use a small ICU subset: `{name}`, `{n, plural, =0 {…} one {# …} other {# …}}` and
// `{value, select, a {…} other {…}}`. Catalogs are flat maps of key → template per locale.

export type Locale = 'pt-BR' | 'en' | 'es';

export const LOCALES: readonly Locale[] = ['pt-BR', 'en', 'es'];

/** Locale used for the `text` fallbacks the server keeps next to every `msg`. */
export const SOURCE_LOCALE: Locale = 'pt-BR';

/** Native name of each locale, for language pickers. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  'pt-BR': 'Português (Brasil)',
  en: 'English',
  es: 'Español',
};

export type MsgParam = string | number | Msg;

/** A localizable text: a catalog key plus its parameters (which may be messages themselves). */
export interface Msg {
  readonly key: string;
  readonly params?: Readonly<Record<string, MsgParam>>;
}

export type Catalog = Readonly<Record<string, string>>;
export type Catalogs = Readonly<Record<Locale, Catalog>>;

type FlatParams = Readonly<Record<string, string | number>>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Best supported locale for a list of BCP 47 tags (e.g. `navigator.languages`): pt → pt-BR, es → es, else en. */
export function resolveLocale(tags: readonly string[]): Locale {
  for (const tag of tags) {
    const lang = tag.toLowerCase().split('-')[0];
    if (lang === 'pt') return 'pt-BR';
    if (lang === 'es') return 'es';
    if (lang === 'en') return 'en';
  }
  return 'en';
}

/** Index of the `}` that closes the `{` at `open`, or -1. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Parses `sel1 {text1} sel2 {text2}` into a map. */
function parseOptions(body: string): Map<string, string> {
  const options = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i] as string)) i++;
    const open = body.indexOf('{', i);
    if (open < 0) break;
    const selector = body.slice(i, open).trim();
    const close = closingBrace(body, open);
    if (close < 0) break;
    options.set(selector, body.slice(open + 1, close));
    i = close + 1;
  }
  return options;
}

function formatValue(locale: Locale, value: string | number): string {
  return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value;
}

function renderArgument(locale: Locale, inner: string, params: FlatParams): string | undefined {
  const [name = '', type, ...rest] = inner.split(',');
  const value = params[name.trim()];
  if (type === undefined) return value === undefined ? undefined : formatValue(locale, value);
  const options = parseOptions(rest.join(','));
  const kind = type.trim();
  if (kind === 'plural') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return undefined;
    const chosen = options.get(`=${n}`) ?? options.get(new Intl.PluralRules(locale).select(n)) ?? options.get('other');
    return chosen === undefined ? undefined : render(locale, chosen, params, formatValue(locale, n));
  }
  if (kind === 'select') {
    const chosen = options.get(String(value)) ?? options.get('other');
    return chosen === undefined ? undefined : render(locale, chosen, params);
  }
  return undefined;
}

function render(locale: Locale, template: string, params: FlatParams, hash?: string): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const ch = template[i] as string;
    if (ch === '{') {
      const close = closingBrace(template, i);
      if (close < 0) return out + template.slice(i);
      const rendered = renderArgument(locale, template.slice(i + 1, close), params);
      out += rendered ?? template.slice(i, close + 1);
      i = close + 1;
    } else {
      out += ch === '#' && hash !== undefined ? hash : ch;
      i++;
    }
  }
  return out;
}

/** Renders one template with flat parameters (numbers are formatted for the locale). */
export function formatMessage(locale: Locale, template: string, params: FlatParams = {}): string {
  return render(locale, template, params);
}

export type Translator = (locale: Locale, msg: Msg, fallback?: string) => string;

/**
 * Translator over a set of catalogs. Lookup order: requested locale, English, pt-BR; then `fallback` (usually the
 * server's pt-BR `text`), then the key itself. Message parameters are translated first.
 */
export function createTranslator(catalogs: Catalogs): Translator {
  const translate: Translator = (locale, msg, fallback) => {
    const template = catalogs[locale][msg.key] ?? catalogs.en[msg.key] ?? catalogs['pt-BR'][msg.key];
    if (template === undefined) return fallback ?? msg.key;
    const flat: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(msg.params ?? {})) {
      flat[name] = typeof value === 'object' ? translate(locale, value) : value;
    }
    return formatMessage(locale, template, flat);
  };
  return translate;
}

/** Merges catalogs per locale (later wins); used to combine shared and app catalogs. */
export function mergeCatalogs(...parts: readonly Partial<Catalogs>[]): Catalogs {
  const merged: Record<Locale, Record<string, string>> = { 'pt-BR': {}, en: {}, es: {} };
  for (const part of parts) for (const locale of LOCALES) Object.assign(merged[locale], part[locale] ?? {});
  return merged;
}
