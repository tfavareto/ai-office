// Which language Whisper is told the speech is in.
import type { Locale } from '@ai-office/shared';
import type { WhisperLanguage } from './worker/protocol';

/** The model's language for an app language, or null (detect it) for 'auto'. */
export function whisperLanguage(language: Locale | 'auto'): WhisperLanguage | null {
  switch (language) {
    case 'pt-BR':
      return 'pt';
    case 'en':
      return 'en';
    case 'es':
      return 'es';
    case 'auto':
      return null;
  }
}
