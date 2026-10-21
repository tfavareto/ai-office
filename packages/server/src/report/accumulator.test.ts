import { describe, expect, test } from 'vitest';
import { REPORT_BUCKETS } from '@ai-office/shared';
import { parseLine } from '../claude/line-parser';
import { T0, assistantLine, text, toolResultLine, toolUse, userLine } from '../test-helpers';
import { type DayWindow, FileDayAccumulator, type FileRole } from './accumulator';

const HOUR = 3_600_000;
const WINDOW: DayWindow = { start: T0 - 6 * HOUR, end: T0 + 18 * HOUR };
const MIN = 60_000;

function run(lines: string[], role: FileRole = 'main', startedInDay = true) {
  const acc = new FileDayAccumulator(WINDOW, role, startedInDay);
  for (const raw of lines) {
    const parsed = parseLine(raw);
    if (parsed !== undefined) acc.ingest(parsed);
  }
  return acc.result();
}

const call = (id: string, name: string, input: Record<string, unknown>, at: number): string =>
  assistantLine([toolUse(id, name, input)], at);
const bash = (id: string, command: string, at: number): string => call(id, 'Bash', { command }, at);
const patch = (added: number, removed: number): Record<string, unknown> => ({
  toolUseResult: {
    structuredPatch: [
      { lines: [...Array.from({ length: added }, () => '+x'), ...Array.from({ length: removed }, () => '-y'), ' ctx'] },
    ],
  },
});

describe('prompts and privacy', () => {
  test('counts the prompts of a main transcript and keeps only the first line of each, truncated', () => {
    const long = `${'a'.repeat(300)}\nsecond line with a secret`;
    const day = run([userLine('Corrija o carrinho\nmais detalhes sigilosos', 0), userLine(long, MIN)]);
    expect(day.prompts).toBe(2);
    expect(day.requests[0]).toBe('Corrija o carrinho');
    expect(day.requests[1]?.length).toBeLessThanOrEqual(140);
    expect(JSON.stringify(day)).not.toContain('sigilosos');
    expect(JSON.stringify(day)).not.toContain('secret');
  });

  test('a subagent transcript does not count its task prompt as a user request', () => {
    expect(run([userLine('Explore o código', 0)], 'sub').prompts).toBe(0);
  });
});

describe('file changes', () => {
  test('counts successful edits per file with the lines of the patch', () => {
    const day = run([
      call('e1', 'Edit', { file_path: '/work/proj/src/a.ts', old_string: 'a', new_string: 'b' }, 0),
      toolResultLine('e1', 'ok', 1000, patch(3, 1)),
      call('e2', 'Edit', { file_path: '/work/proj/src/a.ts', old_string: 'a', new_string: 'b' }, 2000),
      toolResultLine('e2', 'ok', 3000, patch(2, 0)),
    ]);
    expect(day.files).toEqual([{ path: '/work/proj/src/a.ts', edits: 2, added: 5, removed: 1 }]);
  });

  test('estimates lines from the input when the result has no patch (Write, MultiEdit, NotebookEdit)', () => {
    const day = run([
      call('w1', 'Write', { file_path: '/work/proj/new.ts', content: 'a\nb\nc' }, 0),
      toolResultLine('w1', 'created', 1000),
      call(
        'm1',
        'MultiEdit',
        {
          file_path: '/work/proj/m.ts',
          edits: [
            { old_string: 'x', new_string: 'y\nz' },
            { old_string: 'p\nq', new_string: 'r' },
          ],
        },
        2000,
      ),
      toolResultLine('m1', 'ok', 3000),
      call('n1', 'NotebookEdit', { notebook_path: '/work/proj/n.ipynb', new_source: 'print(1)' }, 4000),
      toolResultLine('n1', 'ok', 5000),
    ]);
    const byPath = Object.fromEntries(day.files.map((file) => [file.path, file]));
    expect(byPath['/work/proj/new.ts']).toMatchObject({ added: 3, removed: 0 });
    expect(byPath['/work/proj/m.ts']).toMatchObject({ added: 3, removed: 3 });
    expect(byPath['/work/proj/n.ipynb']).toMatchObject({ added: 1 });
  });

  test('ignores edits that failed and calls without a result', () => {
    const day = run([
      call('e1', 'Edit', { file_path: '/work/proj/a.ts', old_string: 'a', new_string: 'b' }, 0),
      toolResultLine('e1', 'String not found', 1000, {}, true),
      call('e2', 'Edit', { file_path: '/work/proj/b.ts', old_string: 'a', new_string: 'b' }, 2000),
    ]);
    expect(day.files).toEqual([]);
    expect(day.toolCalls.edit).toBe(2);
  });
});

describe('commands, tests and commits', () => {
  test('deduplicates commands, masks secrets and counts runs', () => {
    const day = run([
      bash('b1', 'npm run build', 0),
      bash('b2', 'npm run build', 1000),
      bash('b3', 'deploy --token abc123', 2000),
    ]);
    expect(day.commands).toEqual([
      { command: 'npm run build', runs: 2 },
      { command: 'deploy --token ***', runs: 1 },
    ]);
    expect(JSON.stringify(day)).not.toContain('abc123');
  });

  test('detects test runs and reads pass and fail from the result', () => {
    const day = run([
      bash('t1', 'npx vitest run', 0),
      toolResultLine('t1', 'Tests  12 passed (12)', 1000),
      bash('t2', 'cargo test', 2000),
      toolResultLine('t2', 'Exit code 101\ntest result: FAILED. 3 passed; 1 failed', 3000, {}, true),
      bash('t3', 'ls', 4000),
      toolResultLine('t3', 'a b', 5000),
    ]);
    expect(day.tests).toEqual([
      { runner: 'vitest', at: T0, outcome: 'passed', passed: 12 },
      { runner: 'cargo test', at: T0 + 2000, outcome: 'failed', passed: 3, failed: 1 },
    ]);
  });

  test('detects commits from the git commit output and ignores failed or repeated ones', () => {
    const day = run([
      bash('c1', 'git add -A && git commit -m "feat: carrinho"', 0),
      toolResultLine('c1', '[main abc1234] feat: carrinho\n 1 file changed', 1000),
      bash('c2', 'git commit -m "x"', 2000),
      toolResultLine('c2', 'nothing to commit', 3000, {}, true),
      bash('c3', 'git commit --amend --no-edit', 4000),
      toolResultLine('c3', '[main abc1234] feat: carrinho', 5000),
    ]);
    expect(day.commits).toEqual([
      { hash: 'abc1234', subject: 'feat: carrinho', branch: 'main', at: T0 + 1000, source: 'transcript' },
    ]);
  });
});

describe('tasks and subagents', () => {
  const todo = (status: string): Record<string, unknown> => ({
    todos: [
      { content: 'Criar rota', status, activeForm: 'Criando rota' },
      { content: 'Testar', status: 'pending', activeForm: 'Testando' },
    ],
  });

  test('counts a task when it turns completed during the day, once', () => {
    const day = run([
      call('t1', 'TodoWrite', todo('in_progress'), 0),
      call('t2', 'TodoWrite', todo('completed'), MIN),
      call('t3', 'TodoWrite', todo('completed'), 2 * MIN),
    ]);
    expect(day.tasks).toEqual([{ title: 'Criar rota', at: T0 + MIN }]);
  });

  test('does not claim tasks that were already completed when the day started', () => {
    const day = run([call('t1', 'TodoWrite', todo('completed'), 0)], 'main', false);
    expect(day.tasks).toEqual([]);
  });

  test('follows TaskCreate and TaskUpdate', () => {
    const day = run([
      call('c1', 'TaskCreate', { subject: 'Migrar banco' }, 0),
      toolResultLine('c1', 'created', 1000, { toolUseResult: { task: { id: '7' } } }),
      call('u1', 'TaskUpdate', { taskId: '7', status: 'completed' }, MIN),
    ]);
    expect(day.tasks).toEqual([{ title: 'Migrar banco', at: T0 + MIN }]);
  });

  test('lists the subagents delegated to', () => {
    const day = run([
      call('a1', 'Agent', { description: 'Explorar', subagent_type: 'Explore' }, 0),
      call('a2', 'Task', { description: 'x', subagent_type: 'Explore' }, 1000),
      call('a3', 'Task', { description: 'y' }, 2000),
    ]);
    expect(day).toMatchObject({ subagentCount: 3, subagentTypes: ['Explore', 'general-purpose'] });
    expect(day.toolCalls.subagent).toBe(3);
  });
});

describe('time and window', () => {
  test('ignores lines outside the day', () => {
    const before = userLine('ontem', -7 * HOUR);
    const after = userLine('amanhã', 19 * HOUR);
    const day = run([before, userLine('hoje', 0), after]);
    expect(day.prompts).toBe(1);
    expect(day.firstAt).toBe(T0);
  });

  test('counts short gaps as work and long pauses as rest, bucketed by half hour', () => {
    const day = run([
      userLine('a', 0),
      assistantLine([text('x')], 5 * MIN),
      assistantLine([text('y')], 5 * MIN + 30 * MIN),
      userLine('b', 3 * HOUR),
    ]);
    expect(day.activity).toHaveLength(REPORT_BUCKETS);
    expect(day.activity.reduce((sum, ms) => sum + ms, 0)).toBe(5 * MIN);
  });

  test('splits a span that crosses a bucket boundary', () => {
    const start = WINDOW.start + 25 * MIN;
    const acc = new FileDayAccumulator(WINDOW, 'main', true);
    const at = (ms: number) => parseLine(userLine('x', ms - T0));
    for (const time of [start, start + 8 * MIN]) {
      const parsed = at(time);
      if (parsed !== undefined) acc.ingest(parsed);
    }
    const buckets = acc.result().activity;
    expect(buckets[0]).toBe(5 * MIN);
    expect(buckets[1]).toBe(3 * MIN);
  });

  test('reads the working directory and the custom title', () => {
    const day = run([JSON.stringify({ type: 'custom-title', customTitle: 'Loja' }), userLine('oi', 0)]);
    expect(day).toMatchObject({ cwd: '/work/proj', title: 'Loja' });
  });
});
