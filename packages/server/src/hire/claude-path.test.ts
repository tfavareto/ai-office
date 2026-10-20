import { describe, expect, test } from 'vitest';
import { resolveClaudeExecutable } from './claude-path';

const HOME = '/home/ana';
const executables = (...paths: string[]) => (path: string): boolean => paths.includes(path);

describe('resolveClaudeExecutable', () => {
  test('prefers the first claude on the PATH', () => {
    const found = resolveClaudeExecutable({ env: { PATH: '/usr/local/bin:/opt/bin' }, home: HOME, isExecutable: executables('/opt/bin/claude', '/usr/local/bin/claude', `${HOME}/.local/bin/claude`) });

    expect(found).toBe('/usr/local/bin/claude');
  });

  test('falls back to where the native installer puts the CLI, in order', () => {
    expect(resolveClaudeExecutable({ env: { PATH: '/usr/bin' }, home: HOME, isExecutable: executables(`${HOME}/.local/bin/claude`, `${HOME}/.claude/local/claude`) })).toBe(`${HOME}/.local/bin/claude`);
    expect(resolveClaudeExecutable({ env: { PATH: '/usr/bin' }, home: HOME, isExecutable: executables(`${HOME}/.claude/local/claude`) })).toBe(`${HOME}/.claude/local/claude`);
  });

  test('returns undefined when there is none', () => {
    expect(resolveClaudeExecutable({ env: { PATH: '/usr/bin' }, home: HOME, isExecutable: executables() })).toBeUndefined();
    expect(resolveClaudeExecutable({ env: {}, home: HOME, isExecutable: executables() })).toBeUndefined();
  });

  test('ignores relative PATH entries, so a claude in the current folder is never picked up', () => {
    const found = resolveClaudeExecutable({ env: { PATH: '.:bin::/usr/bin' }, home: HOME, isExecutable: executables('./claude', 'bin/claude', '/claude') });

    expect(found).toBeUndefined();
  });
});
