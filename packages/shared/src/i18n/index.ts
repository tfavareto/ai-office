export * from './i18n';
export type { SharedMessageKey } from './messages/pt-BR';
import { createTranslator, SOURCE_LOCALE, type Catalogs, type Msg, type MsgParam } from './i18n';
import { en } from './messages/en';
import { es } from './messages/es';
import { ptBR } from './messages/pt-BR';
import type { SharedMessageKey } from './messages/pt-BR';

/** Catalogs of the messages emitted by the server and the demo simulator. */
export const SHARED_CATALOGS: Catalogs = { 'pt-BR': ptBR, en, es };

/** Translates shared messages (server/demo keys). */
export const translateShared = createTranslator(SHARED_CATALOGS);

/** Builds a shared message; the key is checked against the catalog. */
export function msg(key: SharedMessageKey, params?: Readonly<Record<string, MsgParam>>): Msg {
  return params === undefined ? { key } : { key, params };
}

/** The pt-BR fallback text of a shared message (what the `text` fields carry next to `msg`). */
export function sourceText(message: Msg): string {
  return translateShared(SOURCE_LOCALE, message);
}
