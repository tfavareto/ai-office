// A translated rollout drives the same TranscriptState (status, activity, tasks, stats) a Claude transcript does.
import { describe, expect, test } from 'vitest';
import { TranscriptState } from '../claude/transcript-state';
import { deriveStatus } from '../office/status';
import { T0 } from '../test-helpers';
import {
  CWD,
  PATCH,
  applyPatch,
  assistantMessage,
  event,
  functionOutput,
  reasoning,
  responseItem,
  sessionMeta,
  shellCall,
  taskComplete,
  taskStarted,
  tokenCount,
  turnContext,
  userMessage,
} from './fixtures';
import { RolloutTranslator } from './translate';

function play(...rows: string[]): TranscriptState {
  const translator = new RolloutTranslator();
  const state = new TranscriptState({ idPrefix: 'codex:t', isSub: false });
  for (const row of rows) for (const line of translator.translate(row)) state.apply(line);
  return state;
}

function statusOf(state: TranscriptState, now: number): string {
  const user = state.pendingUserTool();
  return deriveStatus({
    now,
    turn: state.turn,
    lastEventAt: state.lastEventAt,
    permissionPending: false,
    ...(user !== undefined ? { pendingUserTool: user.waitingFor, pendingUserToolMsg: user.waitingForMsg } : {}),
  }).status;
}

describe('status of a Codex turn', () => {
  test('working from task_started to task_complete, idle after', () => {
    const during = play(sessionMeta(0), taskStarted(1000), userMessage('faça', 1100), shellCall('c', ['ls'], 2000));
    expect(during.turn).toBe('working');
    expect(statusOf(during, T0 + 5000)).toBe('working');
    const after = play(
      sessionMeta(0),
      taskStarted(1000),
      userMessage('faça', 1100),
      assistantMessage('pronto', 4000),
      taskComplete(4100),
    );
    expect(after.turn).toBe('idle');
    expect(statusOf(after, T0 + 5000)).toBe('idle');
    expect(after.activity).toMatchObject({ kind: 'done' });
  });

  test('a turn that starts without a prompt line still works', () => {
    const state = play(taskStarted(0));
    expect(state.turn).toBe('working');
  });

  test('waiting while an approval is pending, working again once it is answered', () => {
    const waiting = play(
      taskStarted(0),
      shellCall('c', ['rm', 'x'], 100),
      event('exec_approval_request', 200, { call_id: 'c' }),
    );
    expect(statusOf(waiting, T0 + 500)).toBe('waiting');
    expect(waiting.pendingUserTool()?.waitingFor).toBe('Aprovar Bash');
    const answered = play(
      taskStarted(0),
      shellCall('c', ['rm', 'x'], 100),
      event('exec_approval_request', 200, { call_id: 'c' }),
      event('exec_command_begin', 9000, { call_id: 'c', command: ['rm', 'x'] }),
    );
    expect(statusOf(answered, T0 + 9500)).toBe('working');
  });

  test('an unanswered approval ends with an aborted turn', () => {
    const state = play(
      taskStarted(0),
      event('exec_approval_request', 200, {}),
      event('turn_aborted', 300, { reason: 'interrupted' }),
    );
    expect(state.pendingUserTool()).toBeUndefined();
    expect(state.turn).toBe('idle');
  });

  test('a question to the user waits until its answer', () => {
    const waiting = play(
      taskStarted(0),
      responseItem('function_call', 100, { name: 'request_user_input', call_id: 'q', arguments: '{}' }),
    );
    expect(statusOf(waiting, T0 + 200)).toBe('waiting');
    const answered = play(
      taskStarted(0),
      responseItem('function_call', 100, { name: 'request_user_input', call_id: 'q', arguments: '{}' }),
      functionOutput('q', 'sim', 500),
    );
    expect(statusOf(answered, T0 + 600)).toBe('working');
  });
});

describe('what the agent shows', () => {
  test('folder, branch, model, mode and title', () => {
    const state = play(sessionMeta(0), turnContext(100), userMessage('Corrigir o login', 200));
    expect(state).toMatchObject({
      cwd: CWD,
      gitBranch: 'feature-x',
      model: 'gpt-5.6-sol',
      permissionMode: 'on-request · workspace-write',
    });
    expect(state.title()).toBe('Corrigir o login');
  });

  test('activities follow the tools', () => {
    const state = play(
      turnContext(0),
      userMessage('x', 10),
      reasoning(20),
      shellCall('c', ['bash', '-lc', 'npm test'], 30),
      functionOutput('c', 'ok', 40, 0),
      applyPatch('p', PATCH, 50),
      functionOutput('p', 'ok', 60),
      responseItem('web_search_call', 70, { id: 'w', action: { type: 'search', query: 'x' } }),
      assistantMessage('feito', 80),
    );
    expect(state.activityHistory().map((activity) => activity.kind)).toEqual([
      'prompt',
      'think',
      'bash',
      'write',
      'edit',
      'edit',
      'web',
      'reply',
    ]);
    expect(state.model).toBe('gpt-5.6-sol');
  });

  test('a failing command is an error activity', () => {
    const state = play(shellCall('c', ['false'], 0), functionOutput('c', 'boom', 10, 1));
    expect(state.activityHistory().map((activity) => activity.kind)).toEqual(['bash', 'error']);
  });

  test('update_plan fills the task list', () => {
    const state = play(
      responseItem('function_call', 0, {
        name: 'update_plan',
        call_id: 'u',
        arguments: JSON.stringify({
          plan: [
            { step: 'A', status: 'completed' },
            { step: 'B', status: 'in_progress' },
          ],
        }),
      }),
    );
    expect(state.tasks.map((task) => [task.title, task.status])).toEqual([
      ['A', 'completed'],
      ['B', 'in_progress'],
    ]);
  });

  test('a foreground command running long counts as a shell job', () => {
    const state = play(shellCall('c', ['sleep', '60'], 0));
    expect(state.shellsAt(T0 + 30_000)).toMatchObject([{ command: 'sleep 60', background: false }]);
  });
});

describe('tokens and cost', () => {
  test('the stats follow the session totals, priced with the model of the turn', () => {
    const state = play(
      turnContext(0),
      tokenCount({ input_tokens: 1_000_000, cached_input_tokens: 800_000, output_tokens: 100_000 }, 10),
      tokenCount({ input_tokens: 2_000_000, cached_input_tokens: 1_500_000, output_tokens: 200_000 }, 20),
    );
    const stats = state.statsSnapshot();
    expect(stats.tokensIn).toBe(500_000);
    expect(stats.tokensOut).toBe(200_000);
    // gpt-5.6-sol: 0.5M fresh x $4 + 1.5M cached x $0.4 + 0.2M out x $20
    expect(stats.costUSD).toBeCloseTo(2 + 0.6 + 4, 6);
  });

  test('a repeated total is not counted twice', () => {
    const state = play(
      turnContext(0),
      tokenCount({ input_tokens: 1000, output_tokens: 10 }, 10),
      tokenCount({ input_tokens: 1000, output_tokens: 10 }, 20),
    );
    expect(state.statsSnapshot()).toMatchObject({ tokensIn: 1000, tokensOut: 10 });
  });

  test('a model without a price has tokens but no cost', () => {
    const state = play(
      turnContext(0, { model: 'codex-auto-review' }),
      tokenCount({ input_tokens: 5, output_tokens: 1 }, 10),
    );
    const stats = state.statsSnapshot();
    expect(stats.tokensIn).toBe(5);
    expect(stats.costUSD).toBeUndefined();
  });

  test('line counts from patches reach the stats', () => {
    const state = play(applyPatch('p', PATCH, 0), functionOutput('p', 'ok', 10));
    expect(state.statsSnapshot()).toMatchObject({ linesAdded: 4, linesRemoved: 1, toolCalls: 3 });
  });
});
