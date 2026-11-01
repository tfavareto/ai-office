// Which speech model the person picked and which language they speak, remembered in this browser (not on the server:
// they are preferences of the page).
import { DEFAULT_VOICE_MODEL_SIZE, isVoiceModelSize, type VoiceModelSize } from '@ai-office/shared';

export const VOICE_PREF_KEY = 'ai-office:voice';

/** 'interface': the language of the interface is the one spoken (the most accurate); 'auto': Whisper detects it. */
export type VoiceLanguageChoice = 'interface' | 'auto';
export const VOICE_LANGUAGE_CHOICES: readonly VoiceLanguageChoice[] = ['interface', 'auto'];

export interface VoicePreference {
  size(): VoiceModelSize;
  setSize(size: VoiceModelSize): void;
  language(): VoiceLanguageChoice;
  setLanguage(language: VoiceLanguageChoice): void;
  onChange(listener: () => void): () => void;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

interface StoredPreference {
  size: VoiceModelSize;
  language: VoiceLanguageChoice;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readStored(storage: StorageLike | null): StoredPreference {
  const fallback: StoredPreference = { size: DEFAULT_VOICE_MODEL_SIZE, language: 'interface' };
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(VOICE_PREF_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const { size, language } = parsed as { size?: unknown; language?: unknown };
    return {
      size: isVoiceModelSize(size) ? size : fallback.size,
      language: language === 'auto' ? 'auto' : 'interface',
    };
  } catch {
    return fallback;
  }
}

/** The stored size; anything that is not one of ours gives the default. */
export function readVoiceSize(storage: StorageLike | null): VoiceModelSize {
  return readStored(storage).size;
}

export function createVoicePreference(storage: StorageLike | null = defaultStorage()): VoicePreference {
  let current = readStored(storage);
  const listeners = new Set<() => void>();
  const update = (next: StoredPreference): void => {
    if (next.size === current.size && next.language === current.language) return;
    current = next;
    try {
      storage?.setItem(VOICE_PREF_KEY, JSON.stringify(current));
    } catch {
      // Private browsing or a full disk: the choice then lasts until the page is closed.
    }
    for (const listener of [...listeners]) listener();
  };
  return {
    size: () => current.size,
    setSize: (size) => update({ ...current, size }),
    language: () => current.language,
    setLanguage: (language) => update({ ...current, language }),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
