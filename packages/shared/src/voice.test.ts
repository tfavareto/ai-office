import { describe, expect, it } from 'vitest';
import {
  VOICE_MODEL_SIZES,
  isVoiceDownloadErrorCode,
  isVoiceModelSize,
  parseVoiceModelId,
  voiceModelId,
} from './voice';

describe('voice model ids', () => {
  it('names every size after the Whisper model it is', () => {
    expect(VOICE_MODEL_SIZES.map(voiceModelId)).toEqual(['whisper-tiny', 'whisper-base', 'whisper-small']);
  });

  it('parses an id back to its size and refuses anything else', () => {
    expect(parseVoiceModelId('whisper-small')).toBe('small');
    expect(parseVoiceModelId('whisper-large')).toBeUndefined();
    expect(parseVoiceModelId('../whisper-base')).toBeUndefined();
    expect(parseVoiceModelId('')).toBeUndefined();
  });

  it('recognizes sizes and download errors', () => {
    expect(isVoiceModelSize('base')).toBe(true);
    expect(isVoiceModelSize('large')).toBe(false);
    expect(isVoiceModelSize(3)).toBe(false);
    expect(isVoiceDownloadErrorCode('integrity')).toBe(true);
    expect(isVoiceDownloadErrorCode('boom')).toBe(false);
  });
});
