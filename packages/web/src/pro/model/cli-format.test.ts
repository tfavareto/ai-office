import type { TranscriptEntry } from '@ai-office/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import {
  canExpand,
  clip,
  formatEntry,
  relativePath,
  shortModel,
  shortPath,
  statusLine,
  toolArgument,
  toolName,
} from './cli-format';

const OPTIONS = { resultLines: 3, expanded: false };

function tool(overrides: Partial<Extract<TranscriptEntry, { kind: 'tool' }>> = {}): TranscriptEntry {
  return { kind: 'tool', at: 1, id: 't1', name: 'Bash', summary: '💻 Rodando npm test', icon: '💻', ...overrides };
}

describe('cli-format', () => {
  beforeEach(() => setLocale('en'));

  it('prints a user prompt after "> "', () => {
    // Arrange
    const entry: TranscriptEntry = { kind: 'user', at: 1, text: '  fix the tests \n' };

    // Act
    const lines = formatEntry(entry, OPTIONS);

    // Assert
    expect(lines).toEqual([{ kind: 'prompt', gutter: '>', text: 'fix the tests', tone: 'accent' }]);
  });

  it('prints a tool call as Name(argument) with its result indented under ⎿', () => {
    // Arrange
    const entry = tool({ input: { command: 'npm test' }, result: 'ok\n' });

    // Act
    const lines = formatEntry(entry, OPTIONS);

    // Assert
    expect(lines).toEqual([
      { kind: 'tool', gutter: '⏺', text: 'Bash(npm test)', tone: 'ok' },
      { kind: 'result', gutter: '⎿', text: 'ok', tone: 'dim' },
    ]);
  });

  it('cuts a long result after a few lines and says how many are left', () => {
    // Arrange
    const result = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');

    // Act
    const lines = formatEntry(tool({ input: { command: 'ls' }, result }), OPTIONS);

    // Assert
    expect(lines[1]?.text).toBe('line 0\nline 1\nline 2');
    expect(lines[2]).toMatchObject({ kind: 'more', text: '… +7 lines (click to expand)' });
    expect(canExpand(tool({ result }), 3)).toBe(true);
  });

  it('shows the whole result when the reader expanded it', () => {
    // Arrange
    const result = 'a\nb\nc\nd\ne';

    // Act
    const lines = formatEntry(tool({ result }), { resultLines: 3, expanded: true });

    // Assert
    expect(lines).toHaveLength(2);
    expect(lines[1]?.text).toBe(result);
  });

  it('marks a running call as pending and a failed one as an error in red', () => {
    // Arrange
    const running = tool({ input: { command: 'npm run build' } });
    const failed = tool({ input: { command: 'npm test' }, result: '3 failed', error: true });

    // Act
    const pending = formatEntry(running, OPTIONS);
    const error = formatEntry(failed, OPTIONS);

    // Assert
    expect(pending).toEqual([{ kind: 'tool', gutter: '⏺', text: 'Bash(npm run build)', tone: 'pending' }]);
    expect(error.map((line) => line.tone)).toEqual(['error', 'error']);
  });

  it('writes a file that was read as a count of lines, never its content', () => {
    // Arrange
    const entry = tool({ name: 'Read', input: { file_path: '/repo/src/a.ts' }, result: 'one\ntwo\nthree' });

    // Act
    const lines = formatEntry(entry, { ...OPTIONS, cwd: '/repo' });

    // Assert
    expect(lines.map((line) => line.text)).toEqual(['Read(src/a.ts)', 'Read 3 lines']);
    expect(canExpand(entry, 1)).toBe(false);
  });

  it('prints thinking as a dim "✻ Thinking…" that opens to its text', () => {
    // Arrange
    const entry: TranscriptEntry = { kind: 'thinking', at: 1, text: 'considering options' };

    // Act
    const closed = formatEntry(entry, OPTIONS);
    const open = formatEntry(entry, { ...OPTIONS, expanded: true });

    // Assert
    expect(closed).toEqual([{ kind: 'thinking', gutter: '✻', text: 'Thinking…', tone: 'dim' }]);
    expect(open[1]?.text).toBe('considering options');
  });

  it('puts the ⏺ only on the first block of an answer and keeps code fences apart', () => {
    // Arrange
    const entry: TranscriptEntry = { kind: 'assistant', at: 1, text: 'Done:\n```ts\nconst a = 1;\n```\nThat is all.' };

    // Act
    const lines = formatEntry(entry, OPTIONS);

    // Assert
    expect(lines.map((line) => [line.kind, line.gutter])).toEqual([
      ['text', '⏺'],
      ['code', ''],
      ['text', ''],
    ]);
  });

  it('picks the argument a developer would expect for each kind of tool', () => {
    // Arrange, Act, Assert
    expect(toolArgument({ input: { pattern: 'useEffect', path: '/repo/src' }, summary: '' }, '/repo')).toBe(
      '"useEffect" in src',
    );
    expect(toolArgument({ input: { url: 'https://example.com' }, summary: '' })).toBe('https://example.com');
    expect(toolArgument({ input: { description: 'Map the modules' }, summary: '' })).toBe('Map the modules');
    expect(toolArgument({ input: {}, summary: '📋 Updating the task list', icon: '📋' })).toBe(
      'Updating the task list',
    );
    expect(toolArgument({ input: { command: 'echo a\necho b' }, summary: '' })).toBe('echo a');
  });

  it('shortens names, paths and models the way a terminal would', () => {
    // Arrange, Act, Assert
    expect(toolName('mcp__github__list_issues')).toBe('github:list_issues');
    expect(toolName('Edit')).toBe('Edit');
    expect(relativePath('/repo/src/a.ts', '/repo/')).toBe('src/a.ts');
    expect(relativePath('/other/a.ts', '/repo')).toBe('/other/a.ts');
    const short = shortPath('/a/very/long/path/that/goes/on/and/on/and/on/to/the/file.ts', 24);
    expect(short).toBe('…/and/on/to/the/file.ts');
    expect(short.length).toBeLessThanOrEqual(24);
    expect(shortModel('claude-opus-4-1-20250805')).toBe('opus-4-1');
    expect(shortModel('gpt-5-codex')).toBe('gpt-5-codex');
    expect(clip('a   b\nc', 10)).toBe('a b c');
    expect(clip('abcdefghijkl', 6)).toBe('abcde…');
  });

  it('writes the status line like the CLI, timed only while the session lives', () => {
    // Arrange, Act
    const working = statusLine('working');
    const waiting = statusLine('waiting');
    const done = statusLine('done');

    // Assert
    expect(working).toEqual({ glyph: '✻', text: 'working', tone: 'ok', timed: true });
    expect(waiting).toMatchObject({ glyph: '◆', text: 'waiting for you', tone: 'warn' });
    expect(done).toMatchObject({ glyph: '✓', timed: false });
  });
});
