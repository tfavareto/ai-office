import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { locale, onLocaleChange, setLocale, t } from '../i18n';
import { PREFS_KEY, PrefsStore, loadPrefs, toWorldOptions, type StorageLike } from '../prefs/prefs';
import { applyLanguagePref, bindLanguage } from './language';

function memoryStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(initial ? [[PREFS_KEY, initial]] : []);
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

describe('interface language preference', () => {
  beforeEach(() => setLocale('pt-BR'));
  afterEach(() => setLocale('pt-BR'));

  it('follows the system language while the preference is automatic', () => {
    const prefs = new PrefsStore(loadPrefs(memoryStorage()), null);

    expect(applyLanguagePref(prefs.get(), 'es')).toBe('es');
    expect(t('settings.language.auto')).toBe('Automático (sistema)');
    expect(applyLanguagePref(prefs.get(), 'en')).toBe('en');
    expect(t('settings.language.auto')).toBe('Automatic (system)');
  });

  it('applies a saved language on startup', () => {
    const storage = memoryStorage(JSON.stringify({ language: 'es' }));
    const prefs = new PrefsStore(loadPrefs(storage), storage);

    applyLanguagePref(prefs.get(), 'en');

    expect(locale()).toBe('es');
    expect(t('topbar.settings')).toBe('Configuración');
  });

  it('switches the texts and notifies listeners as soon as the preference changes', () => {
    const storage = memoryStorage();
    const prefs = new PrefsStore(loadPrefs(storage), storage);
    const seen: string[] = [];
    const stopBinding = bindLanguage(prefs, 'en');
    const stopListening = onLocaleChange((next) => seen.push(`${next}:${t('topbar.settings')}`));

    prefs.set({ language: 'en' });
    prefs.set({ language: 'es' });
    prefs.set({ language: 'es' });
    prefs.set({ language: 'pt-BR' });

    expect(seen).toEqual(['en:Settings', 'es:Configuración', 'pt-BR:Configurações']);
    expect(JSON.parse(storage.data.get(PREFS_KEY) ?? '{}').language).toBe('pt-BR');
    stopListening();
    stopBinding();
  });

  it('goes back to the system language when the preference returns to automatic', () => {
    const prefs = new PrefsStore(loadPrefs(memoryStorage()), null);
    const stop = bindLanguage(prefs, 'es');

    prefs.set({ language: 'en' });
    expect(locale()).toBe('en');
    prefs.set({ language: 'auto' });

    expect(locale()).toBe('es');
    stop();
  });

  it('ignores changes of other preferences', () => {
    const prefs = new PrefsStore(loadPrefs(memoryStorage()), null);
    setLocale('en');
    const stop = bindLanguage(prefs, 'es');

    prefs.set({ sounds: false });

    expect(locale()).toBe('en');
    stop();
  });

  it('hands the locale to the world options', () => {
    const prefs = new PrefsStore(loadPrefs(memoryStorage(JSON.stringify({ language: 'en' }))), null);

    const options = toWorldOptions(prefs.get(), { followSelected: false, reducedMotion: false });

    expect(options.locale).toBe('en');
  });
});
