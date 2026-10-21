// Translator bound to an explicit locale, for the world renderers. The world receives its language through
// `WorldOptions.locale` (it never reads prefs and does not depend on the page-wide `setLocale`), so every text it draws
// goes through `worldText(locale)`. It resolves the same catalogs as `t()` in `i18n/index.ts`.
import {
  createTranslator,
  mergeCatalogs,
  SHARED_CATALOGS,
  type Locale,
  type Msg,
  type MsgParam,
} from '@ai-office/shared';
import { WORLD_CATALOGS, type WorldKey } from './index';

export type WorldParams = Readonly<Record<string, MsgParam>>;

export interface WorldText {
  readonly locale: Locale;
  /** Text of a world catalog key. */
  t(key: WorldKey, params?: WorldParams): string;
  /** Renders a message from the server/demo, or `fallback` (its pt-BR text) when it has none or the key is unknown. */
  tm(message: Msg | undefined, fallback: string): string;
}

const translate = createTranslator(mergeCatalogs(SHARED_CATALOGS, WORLD_CATALOGS));
const cache = new Map<Locale, WorldText>();

export function worldText(locale: Locale): WorldText {
  let text = cache.get(locale);
  if (!text) {
    text = {
      locale,
      t: (key, params) => translate(locale, params === undefined ? { key } : { key, params }),
      tm: (message, fallback) => (message === undefined ? fallback : translate(locale, message, fallback)),
    };
    cache.set(locale, text);
  }
  return text;
}
