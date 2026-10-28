// Which speech model size the person picked, remembered in this browser (not on the server: it is a preference of the page).
import { DEFAULT_VOICE_MODEL_SIZE, isVoiceModelSize, type VoiceModelSize } from '@ai-office/shared';

export const VOICE_PREF_KEY = 'ai-office:voice';

export interface VoicePreference {
  size(): VoiceModelSize;
  setSize(size: VoiceModelSize): void;
  onChange(listener: () => void): () => void;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The stored size; anything that is not one of ours gives the default. */
export function readVoiceSize(storage: StorageLike | null): VoiceModelSize {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(VOICE_PREF_KEY) ?? 'null');
    const size = typeof parsed === 'object' && parsed !== null ? (parsed as { size?: unknown }).size : undefined;
    return isVoiceModelSize(size) ? size : DEFAULT_VOICE_MODEL_SIZE;
  } catch {
    return DEFAULT_VOICE_MODEL_SIZE;
  }
}

export function createVoicePreference(storage: StorageLike | null = defaultStorage()): VoicePreference {
  let size = readVoiceSize(storage);
  const listeners = new Set<() => void>();
  return {
    size: () => size,
    setSize(next) {
      if (next === size) return;
      size = next;
      try {
        storage?.setItem(VOICE_PREF_KEY, JSON.stringify({ size }));
      } catch {
        // Private browsing or a full disk: the choice then lasts until the page is closed.
      }
      for (const listener of [...listeners]) listener();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
