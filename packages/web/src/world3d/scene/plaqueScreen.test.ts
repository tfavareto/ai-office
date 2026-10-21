import { describe, expect, it } from 'vitest';
import { worldText } from '../../i18n/world/translate';
import type { RoomGit } from '../../world/roomGit';
import { plaqueNote } from './plaqueScreen';

const info = (patch: Partial<RoomGit> = {}): RoomGit => ({ ref: 'main', detached: false, dirty: false, conflicted: false, ahead: 0, behind: 0, op: null, ci: 'none', ...patch });

describe('plaqueNote', () => {
  it('says the operation in progress in the language of the viewer', () => {
    expect(plaqueNote(info({ op: 'revert' }), worldText('en'))).toBe('REVERT');
    expect(plaqueNote(info({ op: 'revert' }), worldText('es'))).toBe('REVERSIÓN');
    expect(plaqueNote(info({ op: 'revert' }), worldText('pt-BR'))).toBe('REVERSÃO');
  });

  it('prefers the operation over the commits ahead and behind', () => {
    expect(plaqueNote(info({ op: 'merge', ahead: 3 }), worldText('en'))).toBe('MERGE');
  });

  it('shows the arrows of what is ahead and behind, and nothing when in sync', () => {
    expect(plaqueNote(info({ ahead: 2, behind: 1 }), worldText('en'))).toBe('↑2 ↓1');
    expect(plaqueNote(info({ behind: 4 }), worldText('en'))).toBe('↓4');
    expect(plaqueNote(info(), worldText('en'))).toBe('');
  });
});
