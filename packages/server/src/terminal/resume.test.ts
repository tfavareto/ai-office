import { describe, expect, test } from 'vitest';
import { makeTempDir, removeDir } from '../test-helpers';
import { MAX_RESUMABLE, isSessionId, loadResumable, parseResumable, resumeArguments, saveResumable } from './resume';

const ID = '11111111-2222-3333-4444-555555555555';

describe('isSessionId', () => {
  test('accepts only a session id, so nothing else can reach the command line', () => {
    expect(isSessionId(ID)).toBe(true);
    expect(isSessionId('--dangerously-skip-permissions')).toBe(false);
    expect(isSessionId(`${ID} x`)).toBe(false);
    expect(isSessionId('')).toBe(false);
  });
});

describe('resumeArguments', () => {
  test('asks Claude Code to go on with that session', () => {
    expect(resumeArguments(ID, undefined)).toEqual(['--resume', ID]);
    expect(resumeArguments(ID, '')).toEqual(['--resume', ID]);
  });

  test('keeps its instructions', () => {
    expect(resumeArguments(ID, 'Be brief')).toEqual(['--append-system-prompt', 'Be brief', '--resume', ID]);
  });
});

describe('parseResumable', () => {
  test('keeps what is valid and forgets the rest', () => {
    // Arrange
    const raw = {
      version: 1,
      sessions: [
        { sessionId: ID, cwd: '/w/p', role: 'Revisor', configDir: '/c' },
        { sessionId: 'nope', cwd: '/w/p' },
        { sessionId: ID, cwd: 'relative' },
        { sessionId: ID },
        7,
      ],
    };

    // Act
    const sessions = parseResumable(raw);

    // Assert
    expect(sessions).toEqual([{ sessionId: ID, cwd: '/w/p', role: 'Revisor', configDir: '/c' }]);
  });

  test('forgets an account folder that is not absolute', () => {
    expect(parseResumable({ version: 1, sessions: [{ sessionId: ID, cwd: '/w', configDir: 'x' }] })).toEqual([
      { sessionId: ID, cwd: '/w' },
    ]);
  });

  test('keeps a limited list', () => {
    const sessions = Array.from({ length: MAX_RESUMABLE + 5 }, () => ({ sessionId: ID, cwd: '/w' }));
    expect(parseResumable({ version: 1, sessions })).toHaveLength(MAX_RESUMABLE);
  });

  test('a missing or foreign file means nothing to resume', () => {
    expect(parseResumable(null)).toEqual([]);
    expect(parseResumable({ version: 9, sessions: [] })).toEqual([]);
  });
});

describe('loadResumable', () => {
  test('brings back what was saved and forgets a session whose folder is gone', async () => {
    // Arrange
    const state = await makeTempDir('ai-office-resume-');

    // Act
    await saveResumable(state, [
      { sessionId: ID, cwd: state, roleInstructions: 'Be brief' },
      { sessionId: ID, cwd: `${state}/gone` },
    ]);
    const sessions = await loadResumable(state);
    await removeDir(state);

    // Assert
    expect(sessions).toEqual([{ sessionId: ID, cwd: state, roleInstructions: 'Be brief' }]);
  });

  test('a missing file means nothing to resume', async () => {
    // Arrange
    const state = await makeTempDir('ai-office-resume-');

    // Act
    const sessions = await loadResumable(state);
    await removeDir(state);

    // Assert
    expect(sessions).toEqual([]);
  });
});
