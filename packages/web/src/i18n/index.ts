// Runtime localization for the web app: the current locale, `t()` for app texts and `tm()` for messages that come
// from the server or the demo (shared keys). One module-level state: the page shows one language at a time.
import {
  createTranslator,
  mergeCatalogs,
  resolveLocale,
  SHARED_CATALOGS,
  type Locale,
  type Msg,
  type MsgParam,
  type SharedMessageKey,
} from '@ai-office/shared';
import { UI_CATALOGS, type UiKey } from './ui';
import { WORLD_CATALOGS, type WorldKey } from './world';

export type { UiKey } from './ui';
export type { WorldKey } from './world';
export type TextKey = UiKey | WorldKey | SharedMessageKey;
export type TextParams = Readonly<Record<string, MsgParam>>;

const translate = createTranslator(mergeCatalogs(SHARED_CATALOGS, UI_CATALOGS, WORLD_CATALOGS));
const listeners = new Set<(locale: Locale) => void>();
let current: Locale = 'pt-BR';

/** Locale picked from the browser languages (pt → pt-BR, es → es, anything else → en). */
export function systemLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  return resolveLocale(tags.filter((tag): tag is string => typeof tag === 'string'));
}

export function locale(): Locale {
  return current;
}

/** Switches the language of the page; listeners re-render their texts. */
export function setLocale(next: Locale): void {
  if (next === current) return;
  current = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const listener of [...listeners]) listener(next);
}

export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Text for a key of the app catalogs in the current locale. */
export function t(key: TextKey, params?: TextParams): string {
  return translate(current, params === undefined ? { key } : { key, params });
}

/** Renders a message from the server/demo in the current locale, or `fallback` (its pt-BR text) when absent. */
export function tm(message: Msg | undefined, fallback: string): string;
export function tm(message: Msg | undefined, fallback?: string): string | undefined;
export function tm(message: Msg | undefined, fallback?: string): string | undefined {
  return message === undefined ? fallback : translate(current, message, fallback);
}
