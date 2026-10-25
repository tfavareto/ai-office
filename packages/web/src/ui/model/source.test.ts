import { describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { agent } from '../../test/fixtures';
import { messageBlockedBySource, skippedNote, splitTeam, teamBlockedBySource } from './source';

const claude = agent({ id: 'c1' });
const codex = agent({ id: 'x1', source: 'codex' });

describe('read-only Codex agents', () => {
  it('splits a room into agents a message can reach and read-only ones', () => {
    const split = splitTeam([claude, codex, agent({ id: 'c2' })]);
    expect(split.reachable.map((a) => a.id)).toEqual(['c1', 'c2']);
    expect(split.readOnly.map((a) => a.id)).toEqual(['x1']);
  });

  it('blocks messages to a Codex agent, in the current language', () => {
    setLocale('en');
    expect(messageBlockedBySource(codex)).toBe('Codex is read-only here: it does not receive messages from AI Office.');
    expect(messageBlockedBySource(claude)).toBeNull();
    setLocale('pt-BR');
    expect(messageBlockedBySource(codex)).toContain('somente leitura');
  });

  it('notes how many of a mixed room are skipped, with plural forms', () => {
    setLocale('en');
    expect(skippedNote(splitTeam([claude, codex]))).toBe('1 Codex agent does not receive the message (read-only).');
    expect(skippedNote(splitTeam([claude, codex, agent({ id: 'x2', source: 'codex' })]))).toBe(
      '2 Codex agents do not receive the message (read-only).',
    );
    expect(skippedNote(splitTeam([claude]))).toBeNull();
    expect(skippedNote(splitTeam([codex]))).toBeNull();
    setLocale('pt-BR');
  });

  it('blocks the team composer only when nobody in the room can receive it', () => {
    setLocale('es');
    expect(teamBlockedBySource(splitTeam([codex]))).toContain('solo lectura');
    expect(teamBlockedBySource(splitTeam([claude, codex]))).toBeNull();
    expect(teamBlockedBySource(splitTeam([]))).toBeNull();
    setLocale('pt-BR');
  });
});
