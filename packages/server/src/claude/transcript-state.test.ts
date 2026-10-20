import { describe, expect, test } from 'vitest';
import { messageDraft } from '@ai-office/shared';
import { T0, assistantLine, text, thinking, toolResultLine, toolUse, userLine } from '../test-helpers';
import { parseLine } from './line-parser';
import { TranscriptState } from './transcript-state';
import type { ParsedLine } from './types';

function feed(state: TranscriptState, ...raw: string[]) {
  return raw.map((line) => state.apply(parseLine(line) as ParsedLine));
}

const main = (): TranscriptState => new TranscriptState({ idPrefix: 'a:s', isSub: false });

describe('TranscriptState turns and activities', () => {
  test('a prompt starts a turn and produces the "Nova tarefa" activity', () => {
    const state = main();
    const [effects] = feed(state, userLine('Implemente o login', 0));
    expect(state.turn).toBe('working');
    expect(effects?.promptSeen).toBe(true);
    expect(state.activity).toMatchObject({ kind: 'prompt', icon: '📨', text: 'Nova tarefa: “Implemente o login”' });
    expect(state.title()).toBe('Implemente o login');
  });

  test('tool calls map to pt-BR activities and stay pending until the result', () => {
    const state = main();
    feed(state, userLine('x', 0), assistantLine([toolUse('t1', 'Read', { file_path: '/p/App.tsx' })], 1000, { stopReason: 'tool_use' }));
    expect(state.activity?.text).toBe('Lendo App.tsx');
    expect(state.pendingTools().map((t) => t.id)).toEqual(['t1']);
    const [effects] = feed(state, toolResultLine('t1', 'conteúdo', 2000));
    expect(state.pendingTools()).toHaveLength(0);
    expect(effects?.toolResults).toEqual([{ toolUseId: 't1', name: 'Read' }]);
    expect(state.turn).toBe('working');
  });

  test('thinking and text blocks produce activities; end_turn completes the turn once', () => {
    const state = main();
    feed(state, userLine('x', 0));
    const effects = feed(
      state,
      assistantLine([thinking()], 1000, { id: 'm1', stopReason: 'end_turn' }),
      assistantLine([text('Pronto!')], 61_000, { id: 'm1', stopReason: 'end_turn' }),
    );
    expect(state.recent().map((a) => a.kind)).toEqual(['prompt', 'think', 'done', 'reply']);
    expect(state.turn).toBe('idle');
    const completions = effects.filter((e) => e.turnCompleted !== undefined);
    expect(completions).toHaveLength(1);
    expect(completions[0]?.turnCompleted?.durationMs).toBe(1000);
  });

  test('tool errors create an error activity and effect', () => {
    const state = main();
    feed(state, userLine('x', 0), assistantLine([toolUse('b1', 'Bash', { command: 'npm test' })], 100));
    const [effects] = feed(state, toolResultLine('b1', 'FAIL', 200, {}, true));
    expect(effects?.error).toMatchObject({ tool: 'Bash' });
    expect(state.activity).toMatchObject({ kind: 'error', icon: '⚠️', text: 'Erro em Bash', error: true });
  });

  test('interruptions end the turn and drop foreground tools', () => {
    const state = main();
    feed(state, userLine('x', 0), assistantLine([toolUse('b1', 'Bash', { command: 'sleep 100' })], 100), userLine('[Request interrupted by user]', 500));
    expect(state.turn).toBe('idle');
    expect(state.pendingTools()).toHaveLength(0);
  });

  test('records metadata: model, branch, cwd, permission mode, custom title wins', () => {
    const state = main();
    feed(state, userLine('primeira', 0, { cwd: '/work/x', gitBranch: 'feat/a' }), assistantLine([text('oi')], 10, { extra: { cwd: '/work/x' } }));
    feed(state, '{"type":"custom-title","customTitle":"Título"}');
    expect(state).toMatchObject({ model: 'claude-sonnet-5-5', gitBranch: 'feat/a', cwd: '/work/x', permissionMode: 'default' });
    expect(state.title()).toBe('Título');
  });
});

describe('TranscriptState tasks, shells and spawns', () => {
  test('TodoWrite replaces the task list', () => {
    const state = main();
    feed(state, assistantLine([toolUse('t', 'TodoWrite', { todos: [{ content: 'A', status: 'completed', activeForm: 'Fazendo A' }, { content: 'B', status: 'in_progress' }, { content: '' }] })], 0));
    expect(state.tasks).toEqual([
      { id: '1', title: 'A', activeForm: 'Fazendo A', status: 'completed', changedAt: T0 },
      { id: '2', title: 'B', status: 'in_progress', changedAt: T0 },
    ]);
  });

  test('a task keeps its stamp until its status changes', () => {
    const state = main();
    feed(
      state,
      assistantLine([toolUse('t1', 'TodoWrite', { todos: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] })], 0),
      assistantLine([toolUse('t2', 'TodoWrite', { todos: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'pending' }] })], 5000),
    );
    expect(state.tasks.map((task) => [task.title, task.status, task.changedAt])).toEqual([
      ['A', 'completed', T0 + 5000],
      ['B', 'pending', T0],
    ]);
  });

  test('TaskCreate / TaskUpdate maintain the list and adopt the real task id', () => {
    const state = main();
    feed(
      state,
      assistantLine([toolUse('c1', 'TaskCreate', { subject: 'Escrever testes' })], 0),
      toolResultLine('c1', 'created', 10, { toolUseResult: { task: { id: '7' } } }),
      assistantLine([toolUse('u1', 'TaskUpdate', { taskId: '7', status: 'in_progress' })], 20),
    );
    expect(state.tasks).toEqual([{ id: '7', title: 'Escrever testes', status: 'in_progress', changedAt: T0 + 20 }]);
  });

  test('background Bash becomes a shell job until its notification; KillShell removes it too', () => {
    const state = main();
    feed(
      state,
      assistantLine([toolUse('bg', 'Bash', { command: 'npm run dev', description: 'Servidor', run_in_background: true })], 0),
      toolResultLine('bg', 'started', 10, { toolUseResult: { backgroundTaskId: 'task1' } }),
    );
    expect(state.shellsAt(T0 + 20)).toMatchObject([{ id: 'bg', label: 'Servidor', command: 'npm run dev', background: true, kind: 'shell' }]);
    feed(state, JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date(T0 + 99).toISOString(), content: '<task-notification><tool-use-id>bg</tool-use-id><status>completed</status></task-notification>' }));
    expect(state.shellsAt(T0 + 100)).toHaveLength(0);

    feed(state, assistantLine([toolUse('bg2', 'Bash', { command: 'tail -f x', run_in_background: true })], 200), toolResultLine('bg2', 'ok', 210, { toolUseResult: { backgroundTaskId: 'task2' } }), assistantLine([toolUse('k', 'KillShell', { shell_id: 'task2' })], 300));
    expect(state.shellsAt(T0 + 400)).toHaveLength(0);
  });

  test('foreground Bash running over 10 s is reported as a shell; Monitor is a monitor job', () => {
    const state = main();
    feed(state, assistantLine([toolUse('fg', 'Bash', { command: 'npm test' })], 0), assistantLine([toolUse('mon', 'Monitor', { description: 'logs' })], 5));
    expect(state.shellsAt(T0 + 5000).map((s) => s.id)).toEqual(['mon']);
    const shells = state.shellsAt(T0 + 11_000);
    expect(shells.find((s) => s.id === 'fg')).toMatchObject({ background: false, kind: 'shell' });
    expect(shells.find((s) => s.id === 'mon')).toMatchObject({ kind: 'monitor' });
  });

  test('sync Agent spawn completes with its result; async spawn completes with the notification', () => {
    const state = main();
    feed(state, assistantLine([toolUse('s1', 'Agent', { description: 'Explorar', subagent_type: 'Explore' }), toolUse('s2', 'Task', { description: 'Rodar em background', run_in_background: true })], 0));
    expect(state.spawns().map((s) => [s.toolUseId, s.done, s.async])).toEqual([['s1', false, false], ['s2', false, true]]);
    feed(state, toolResultLine('s1', 'feito', 100), toolResultLine('s2', 'launched', 110, { toolUseResult: { isAsync: true, agentId: 'zz' } }));
    expect(state.spawn('s1')?.done).toBe(true);
    expect(state.spawn('s2')?.done).toBe(false);
    feed(state, JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date(T0 + 500).toISOString(), content: '<task-notification><task-id>zz</task-id><status>completed</status></task-notification>' }));
    expect(state.spawn('s2')).toMatchObject({ done: true, doneAt: T0 + 500 });
    expect(state.statsSnapshot().subagents).toBe(2);
  });

  test('AskUserQuestion and ExitPlanMode are user-facing pending tools', () => {
    const state = main();
    feed(state, assistantLine([toolUse('q', 'AskUserQuestion', { questions: [] })], 0));
    expect(state.pendingUserTool()?.waitingFor).toBe('Responder uma pergunta');
    expect(state.oldestBlockingTool()).toBeUndefined();
    feed(state, toolResultLine('q', 'resposta', 10));
    expect(state.pendingUserTool()).toBeUndefined();
  });

  test('oldestBlockingTool ignores delegation and background tools', () => {
    const state = main();
    feed(state, assistantLine([toolUse('a', 'Agent', { description: 'x' }), toolUse('b', 'Bash', { command: 'ls' })], 0));
    expect(state.oldestBlockingTool()?.id).toBe('b');
  });
});

describe('TranscriptState stats', () => {
  test('counts tool calls, tokens deduplicated per message, lines and estimates cost', () => {
    const state = main();
    const usage = { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000 };
    feed(
      state,
      assistantLine([thinking()], 0, { id: 'm1', usage }),
      assistantLine([toolUse('e', 'Edit', { file_path: '/a.ts' })], 1, { id: 'm1', usage }),
      toolResultLine('e', 'ok', 2, { toolUseResult: { structuredPatch: [{ lines: ['+a', '+b', '-c'] }] } }),
    );
    const stats = state.statsSnapshot();
    expect(stats).toMatchObject({ toolCalls: 1, tokensIn: 1100, tokensOut: 50, linesAdded: 2, linesRemoved: 1 });
    expect(stats.costUSD).toBeCloseTo((100 * 3 + 50 * 15 + 1000 * 3.75 + 5000 * 0.3) / 1e6, 8);
  });

  test('unknown models leave the cost undefined; cost-state sets the baseline', () => {
    const state = main();
    feed(state, assistantLine([text('x')], 0, { model: 'mystery-model' }));
    expect(state.statsSnapshot().costUSD).toBeUndefined();
    feed(state, '{"type":"cost-state","totalCostUSD":12,"totalLinesAdded":40,"totalLinesRemoved":3}');
    expect(state.statsSnapshot()).toMatchObject({ costUSD: 12, linesAdded: 40, linesRemoved: 3 });
  });

  test('usage effects expose the merged record for account totals', () => {
    const state = main();
    const [effects] = feed(state, assistantLine([text('x')], 0, { id: 'mm' }));
    expect(effects?.usage).toMatchObject({ messageId: 'mm', model: 'claude-sonnet-5-5' });
  });

  test('subagent states do not emit prompt activities or turn completion', () => {
    const sub = new TranscriptState({ idPrefix: 'a:s:ag', isSub: true });
    const effects = feed(sub, userLine('prompt da tarefa', 0), assistantLine([text('ok')], 10, { stopReason: 'end_turn' }));
    expect(sub.recent().map((a) => a.kind)).toEqual(['reply']);
    expect(effects[1]?.turnCompleted).toBeUndefined();
    expect(sub.turn).toBe('idle');
  });

  test('history keeps at most 300 activities and recent the last 30', () => {
    const state = main();
    for (let i = 0; i < 320; i++) feed(state, assistantLine([thinking()], i, { id: `m${i}` }));
    expect(state.activityHistory()).toHaveLength(300);
    expect(state.recent()).toHaveLength(30);
  });

  test('addExternal appends an activity outside the transcript', () => {
    const state = main();
    const activity = state.addExternal(messageDraft('oi'), T0);
    expect(state.activity).toEqual(activity);
    expect(activity).toMatchObject({ text: 'Mensagem sua: oi', msg: { key: 'activity.message', params: { text: 'oi' } } });
  });
});
