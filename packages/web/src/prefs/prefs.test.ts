import { describe, expect, it } from 'vitest';
import { computeInsets } from '../ui/layout';
import { resolveShortcut } from '../ui/shortcuts';
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  PrefsStore,
  effectiveLocale,
  loadPrefs,
  parsePrefs,
  parsePrefsJson,
  savePrefs,
  toWorldOptions,
  type StorageLike,
} from './prefs';

function memoryStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(initial ? [[PREFS_KEY, initial]] : []);
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

describe('parsePrefs', () => {
  it('falls back to defaults for non-objects', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs([1, 2])).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('x')).toEqual(DEFAULT_PREFS);
  });

  it('validates each field independently', () => {
    const prefs = parsePrefs({
      visual: '3d',
      daylight: 'twilight',
      showNames: 'yes',
      bubbles: 'none',
      volume: 5,
      animation: 'lively',
      sounds: false,
    });
    expect(prefs.visual).toBe('3d');
    expect(prefs.daylight).toBe(DEFAULT_PREFS.daylight);
    expect(prefs.showNames).toBe(DEFAULT_PREFS.showNames);
    expect(prefs.bubbles).toBe('none');
    expect(prefs.volume).toBe(1);
    expect(prefs.animation).toBe('lively');
    expect(prefs.sounds).toBe(false);
  });

  it('celebrates by default and validates the setting', () => {
    expect(DEFAULT_PREFS.celebrations).toBe(true);
    expect(parsePrefs({ celebrations: false }).celebrations).toBe(false);
    expect(parsePrefs({ celebrations: 'no' }).celebrations).toBe(true);
    expect(
      toWorldOptions({ ...DEFAULT_PREFS, celebrations: false }, { followSelected: false, reducedMotion: false })
        .celebrations,
    ).toBe(false);
  });

  it('survives broken JSON', () => {
    expect(parsePrefsJson('{oops')).toEqual(DEFAULT_PREFS);
    expect(parsePrefsJson(null)).toEqual(DEFAULT_PREFS);
  });
});

describe('storage', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    expect(savePrefs({ ...DEFAULT_PREFS, visual: '3d' }, storage)).toBe(true);
    expect(loadPrefs(storage).visual).toBe('3d');
  });

  it('works without storage or when it throws', () => {
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(savePrefs(DEFAULT_PREFS, null)).toBe(false);
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadPrefs(broken)).toEqual(DEFAULT_PREFS);
    expect(savePrefs(DEFAULT_PREFS, broken)).toBe(false);
  });
});

describe('PrefsStore', () => {
  it('persists changes and reports which keys changed', () => {
    const storage = memoryStorage();
    const store = new PrefsStore({ ...DEFAULT_PREFS }, storage);
    const seen: string[][] = [];
    store.subscribe((_, changed) => seen.push([...changed]));
    store.set({ visual: '3d', showNames: DEFAULT_PREFS.showNames });
    store.set({ visual: '3d' });
    expect(seen).toEqual([['visual']]);
    expect(JSON.parse(storage.data.get(PREFS_KEY) ?? '{}').visual).toBe('3d');
  });

  it('maps preferences to world options', () => {
    const options = toWorldOptions(
      { ...DEFAULT_PREFS, animation: 'lively', bubbles: 'all' },
      { followSelected: true, reducedMotion: true },
    );
    expect(options).toMatchObject({ liveliness: 'lively', bubbles: 'all', followSelected: true, reducedMotion: true });
  });

  it('shows the repository state by default and lets the world hide it', () => {
    const base = { followSelected: false, reducedMotion: false };
    expect(DEFAULT_PREFS.showGit).toBe(true);
    expect(toWorldOptions(DEFAULT_PREFS, base).showGit).toBe(true);
    expect(toWorldOptions({ ...DEFAULT_PREFS, showGit: false }, base).showGit).toBe(false);
    expect(parsePrefs({ showGit: 'no' }).showGit).toBe(true);
    expect(parsePrefs({ showGit: false }).showGit).toBe(false);
  });

  it('lets the office evolve by default, hides the project of the employee of the month, and validates both', () => {
    const base = { followSelected: false, reducedMotion: false };
    expect(DEFAULT_PREFS).toMatchObject({ evolution: true, employeeProject: false });
    expect(toWorldOptions(DEFAULT_PREFS, base).evolution).toBe(true);
    expect(toWorldOptions({ ...DEFAULT_PREFS, evolution: false }, base).evolution).toBe(false);
    expect(parsePrefs({ evolution: 'no', employeeProject: 1 })).toMatchObject({
      evolution: true,
      employeeProject: false,
    });
    expect(parsePrefs({ evolution: false, employeeProject: true })).toMatchObject({
      evolution: false,
      employeeProject: true,
    });
  });

  it('keeps empty desks inert unless the page can hire', () => {
    const base = { followSelected: false, reducedMotion: false };
    expect(toWorldOptions(DEFAULT_PREFS, base).hireEnabled).toBe(false);
    expect(toWorldOptions(DEFAULT_PREFS, { ...base, hireEnabled: true }).hireEnabled).toBe(true);
  });
});

describe('language', () => {
  it('defaults to auto and keeps only supported values', () => {
    expect(DEFAULT_PREFS.language).toBe('auto');
    expect(parsePrefs({ language: 'es' }).language).toBe('es');
    expect(parsePrefs({ language: 'fr' }).language).toBe('auto');
  });

  it('resolves auto to the system locale and keeps an explicit choice', () => {
    expect(effectiveLocale({ ...DEFAULT_PREFS, language: 'auto' }, 'es')).toBe('es');
    expect(effectiveLocale({ ...DEFAULT_PREFS, language: 'en' }, 'es')).toBe('en');
  });

  it('passes the locale to the world options', () => {
    const options = toWorldOptions(DEFAULT_PREFS, { followSelected: false, reducedMotion: false, locale: 'en' });
    expect(options.locale).toBe('en');
  });
});

describe('layout insets', () => {
  it('leaves room for open panels on wide screens', () => {
    const insets = computeInsets({ sidebarOpen: true, drawerOpen: true, feedOpen: false, narrow: false });
    expect(insets).toEqual({ top: 56, left: 344, right: 404, bottom: 64 });
  });

  it('ignores overlay panels on narrow screens', () => {
    const insets = computeInsets({ sidebarOpen: true, drawerOpen: true, feedOpen: true, narrow: true });
    expect(insets.left).toBe(0);
    expect(insets.right).toBe(0);
    expect(insets.bottom).toBe(224);
  });
});

describe('resolveShortcut', () => {
  const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
  });

  it('maps the documented keys', () => {
    const expected: Record<string, string> = {
      '/': 'search',
      F: 'follow',
      t: 'terminal',
      N: 'message',
      p: 'permission',
      m: 'day',
      U: 'usage',
      K: 'board',
      o: 'overview',
      '[': 'sidebar',
      ']': 'feed',
      '?': 'help',
    };
    for (const [k, action] of Object.entries(expected)) expect(resolveShortcut(key(k), false, false)).toBe(action);
  });

  it('ignores plain keys while typing but keeps Escape', () => {
    expect(resolveShortcut(key('f'), true, false)).toBeNull();
    expect(resolveShortcut(key('Escape'), true, false)).toBe('escape');
  });

  it('claims Ctrl/Cmd+F only with the terminal open', () => {
    expect(resolveShortcut(key('f', { ctrlKey: true }), false, true)).toBe('find');
    expect(resolveShortcut(key('f', { metaKey: true }), true, true)).toBe('find');
    expect(resolveShortcut(key('f', { ctrlKey: true }), false, false)).toBeNull();
    expect(resolveShortcut(key('t', { metaKey: true }), false, true)).toBeNull();
  });
});
