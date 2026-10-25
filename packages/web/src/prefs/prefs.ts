// User preferences persisted in localStorage (`ai-office:prefs`), validated field by field on load.
import { LOCALES, type AccountLimits, type Locale } from '@ai-office/shared';
import { systemLocale } from '../i18n';
import { DEFAULT_WORLD_OPTIONS, type DaylightMode, type WorldOptions } from '../world/api';

export const PREFS_KEY = 'ai-office:prefs';

export type VisualKind = '2d' | '3d';
export type BubbleMode = WorldOptions['bubbles'];
export type Liveliness = WorldOptions['liveliness'];
/** Interface language: `auto` follows the browser (pt → pt-BR, es → es, otherwise en). */
export type LanguagePref = 'auto' | Locale;

export interface Prefs {
  language: LanguagePref;
  visual: VisualKind;
  daylight: DaylightMode;
  showNames: boolean;
  bubbles: BubbleMode;
  animation: Liveliness;
  sounds: boolean;
  /** 0..1 */
  volume: number;
  browserNotifications: boolean;
  /** "Não perturbe": only alerts interrupt. */
  dnd: boolean;
  sidebarOpen: boolean;
  feedOpen: boolean;
  /** Show the repository state (branch, changes, pull request) of each room. */
  showGit: boolean;
  /** Confetti and cheering when something goes well (tests fixed, tasks done, commits...). */
  celebrations: boolean;
  /** Plan limits the user typed in per account id (the reference of the usage forecast). */
  usageLimits: Readonly<Record<string, AccountLimits>>;
}

export const DEFAULT_PREFS: Prefs = {
  language: 'auto',
  visual: '2d',
  daylight: DEFAULT_WORLD_OPTIONS.daylight,
  showNames: DEFAULT_WORLD_OPTIONS.showNames,
  bubbles: DEFAULT_WORLD_OPTIONS.bubbles,
  animation: DEFAULT_WORLD_OPTIONS.liveliness,
  sounds: true,
  volume: 0.5,
  browserNotifications: false,
  dnd: false,
  sidebarOpen: true,
  feedOpen: false,
  showGit: true,
  celebrations: true,
  usageLimits: {},
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function unit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

const MAX_LIMIT_ACCOUNTS = 32;
const MAX_ACCOUNT_ID_LENGTH = 80;
const MAX_LIMIT_VALUE = 1e12;

function limitValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_LIMIT_VALUE
    ? value
    : undefined;
}

/** Limits per account: only well-formed entries survive. An account with no value and the default unit has no entry. */
export function parseUsageLimits(raw: unknown): Record<string, AccountLimits> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const result: Record<string, AccountLimits> = {};
  for (const [accountId, entry] of Object.entries(raw).slice(0, MAX_LIMIT_ACCOUNTS)) {
    if (
      accountId.length === 0 ||
      accountId.length > MAX_ACCOUNT_ID_LENGTH ||
      typeof entry !== 'object' ||
      entry === null
    )
      continue;
    const data = entry as Record<string, unknown>;
    const window5h = limitValue(data.window5h);
    const week = limitValue(data.week);
    const unit = data.unit === 'tokens' ? 'tokens' : 'usd';
    if (window5h === undefined && week === undefined && unit === 'usd') continue;
    result[accountId] = {
      unit,
      ...(window5h !== undefined ? { window5h } : {}),
      ...(week !== undefined ? { week } : {}),
    };
  }
  return result;
}

/** Validates unknown data (parsed JSON) into complete preferences; invalid fields fall back to defaults. */
export function parsePrefs(raw: unknown): Prefs {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_PREFS };
  const data = raw as Record<string, unknown>;
  return {
    language: oneOf(data.language, ['auto', ...LOCALES], DEFAULT_PREFS.language),
    visual: oneOf(data.visual, ['2d', '3d'], DEFAULT_PREFS.visual),
    daylight: oneOf(data.daylight, ['auto', 'day', 'night'], DEFAULT_PREFS.daylight),
    showNames: bool(data.showNames, DEFAULT_PREFS.showNames),
    bubbles: oneOf(data.bubbles, ['all', 'important', 'none'], DEFAULT_PREFS.bubbles),
    animation: oneOf(data.animation, ['calm', 'normal', 'lively'], DEFAULT_PREFS.animation),
    sounds: bool(data.sounds, DEFAULT_PREFS.sounds),
    volume: unit(data.volume, DEFAULT_PREFS.volume),
    browserNotifications: bool(data.browserNotifications, DEFAULT_PREFS.browserNotifications),
    dnd: bool(data.dnd, DEFAULT_PREFS.dnd),
    sidebarOpen: bool(data.sidebarOpen, DEFAULT_PREFS.sidebarOpen),
    feedOpen: bool(data.feedOpen, DEFAULT_PREFS.feedOpen),
    showGit: bool(data.showGit, DEFAULT_PREFS.showGit),
    celebrations: bool(data.celebrations, DEFAULT_PREFS.celebrations),
    usageLimits: parseUsageLimits(data.usageLimits),
  };
}

export function parsePrefsJson(text: string | null): Prefs {
  if (text === null) return { ...DEFAULT_PREFS };
  try {
    return parsePrefs(JSON.parse(text));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPrefs(storage: StorageLike | null = defaultStorage()): Prefs {
  if (!storage) return { ...DEFAULT_PREFS };
  try {
    return parsePrefsJson(storage.getItem(PREFS_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

/** The locale the page should use for these preferences. */
export function effectiveLocale(prefs: Prefs, system: Locale = systemLocale()): Locale {
  return prefs.language === 'auto' ? system : prefs.language;
}

export function toWorldOptions(
  prefs: Prefs,
  extra: { followSelected: boolean; reducedMotion: boolean; locale?: Locale; hireEnabled?: boolean },
): WorldOptions {
  return {
    locale: extra.locale ?? effectiveLocale(prefs),
    showNames: prefs.showNames,
    bubbles: prefs.bubbles,
    liveliness: prefs.animation,
    daylight: prefs.daylight,
    followSelected: extra.followSelected,
    reducedMotion: extra.reducedMotion,
    hireEnabled: extra.hireEnabled ?? false,
    showGit: prefs.showGit,
    celebrations: prefs.celebrations,
  };
}

type Listener = (prefs: Prefs, changed: readonly (keyof Prefs)[]) => void;

/** Holds the current preferences, persists changes and tells listeners which keys changed. */
export class PrefsStore {
  private current: Prefs;
  private readonly listeners = new Set<Listener>();

  constructor(
    initial: Prefs = loadPrefs(),
    private readonly storage: StorageLike | null = defaultStorage(),
  ) {
    this.current = initial;
  }

  get(): Prefs {
    return this.current;
  }

  set(patch: Partial<Prefs>): void {
    const changed = (Object.keys(patch) as (keyof Prefs)[]).filter(
      (key) => patch[key] !== undefined && patch[key] !== this.current[key],
    );
    if (changed.length === 0) return;
    this.current = parsePrefs({ ...this.current, ...patch });
    savePrefs(this.current, this.storage);
    for (const listener of this.listeners) listener(this.current, changed);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
