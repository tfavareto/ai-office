// Interface language: applies the saved preference to the runtime (the page shows one language at a time).
import type { Locale } from '@ai-office/shared';
import { locale, setLocale } from '../i18n';
import { effectiveLocale, type Prefs, type PrefsStore } from '../prefs/prefs';

/**
 * Makes the runtime follow `prefs.language` ("auto" = the browser's languages) and keeps `<html lang>` in sync.
 * Components subscribed with `onLocaleChange` re-render when the effective language actually changes.
 */
export function applyLanguagePref(prefs: Prefs, system?: Locale): Locale {
  setLocale(effectiveLocale(prefs, system));
  if (typeof document !== 'undefined') document.documentElement.lang = locale();
  return locale();
}

/**
 * Applies the language whenever the preference changes (the settings selector writes `prefs.language`). Subscribe
 * before the other preference listeners so they already see the new language. Returns the unsubscribe function.
 */
export function bindLanguage(store: PrefsStore, system?: Locale): () => void {
  return store.subscribe((prefs, changed) => {
    if (changed.includes('language')) applyLanguagePref(prefs, system);
  });
}
