import { describe, expect, test } from 'vitest';
import type { Account } from '@ai-office/shared';
import { parseLine } from '../claude/line-parser';
import type { ParsedLine } from '../claude/types';
import { T0, assistantLine, text, toolResultLine, toolUse, userLine } from '../test-helpers';
import {
  LEAVE_LINGER_MS,
  SUB_IDLE_DONE_MS,
  createSessionRecord,
  createSubRecord,
  isSubDone,
  subVisible,
} from './records';

const account: Account = { id: 'claude', label: 'Pessoal', initial: 'P', color: '#fff', dir: '/x' };

function setup() {
  const record = createSessionRecord(account, 's1', undefined, true, T0);
  const apply = (state: 'main' | 'sub', ...lines: string[]): void => {
    const target = state === 'main' ? record.main : sub.state;
    for (const line of lines) target.apply(parseLine(line) as ParsedLine);
  };
  const sub = createSubRecord(record, 'ag1', { agentType: 'Explore', description: 'Mapear', toolUseId: 'tu1' });
  record.subs.set('ag1', sub);
  return { record, sub, apply };
}

describe('subagent lifecycle', () => {
  test('a sync subagent is done as soon as its spawning tool_use gets a result', () => {
    const { record, sub, apply } = setup();
    apply('main', userLine('x', 0), assistantLine([toolUse('tu1', 'Agent', { description: 'Mapear' })], 10));
    apply('sub', userLine('tarefa', 20), assistantLine([toolUse('r', 'Read', { file_path: '/a' })], 30));
    expect(isSubDone(record, sub, T0 + 1000)).toBe(false);
    apply('main', toolResultLine('tu1', 'resultado', 5000));
    expect(isSubDone(record, sub, T0 + 5001)).toBe(true);
  });

  test('an async subagent survives its launch result and ends with the task notification', () => {
    const { record, sub, apply } = setup();
    apply(
      'main',
      assistantLine([toolUse('tu1', 'Agent', { description: 'Mapear', run_in_background: true })], 10),
      toolResultLine('tu1', 'launched', 20, { toolUseResult: { isAsync: true } }),
    );
    apply('sub', assistantLine([toolUse('r', 'Read', { file_path: '/a' })], 30));
    expect(isSubDone(record, sub, T0 + 1000)).toBe(false);
    apply(
      'main',
      JSON.stringify({
        type: 'queue-operation',
        operation: 'enqueue',
        timestamp: new Date(T0 + 2000).toISOString(),
        content: '<task-notification><tool-use-id>tu1</tool-use-id><status>completed</status></task-notification>',
      }),
    );
    expect(isSubDone(record, sub, T0 + 2100)).toBe(true);
  });

  test('a subagent resumed after its completion notice is working again', () => {
    const { record, sub, apply } = setup();
    apply(
      'main',
      assistantLine([toolUse('tu1', 'Agent', { description: 'x', run_in_background: true })], 0),
      JSON.stringify({
        type: 'queue-operation',
        operation: 'enqueue',
        timestamp: new Date(T0 + 1000).toISOString(),
        content: '<task-notification><tool-use-id>tu1</tool-use-id><status>completed</status></task-notification>',
      }),
    );
    apply('sub', assistantLine([toolUse('r', 'Read', { file_path: '/a' })], 9000));
    expect(isSubDone(record, sub, T0 + 9500)).toBe(false);
  });

  test('a subagent that ended its own turn is done after a short grace', () => {
    const { record, sub, apply } = setup();
    apply('sub', userLine('tarefa', 0), assistantLine([text('feito')], 100, { stopReason: 'end_turn' }));
    expect(isSubDone(record, sub, T0 + 2000)).toBe(false);
    expect(isSubDone(record, sub, T0 + 10_000)).toBe(true);
  });

  test('idle for 2 minutes counts as done when the parent is idle, async or the spawn is unknown', () => {
    const { record, sub, apply } = setup();
    apply('main', userLine('x', 0), assistantLine([toolUse('tu1', 'Agent', { description: 'x' })], 1));
    apply('sub', assistantLine([toolUse('r', 'Read', { file_path: '/a' })], 10));
    const later = T0 + 10 + SUB_IDLE_DONE_MS + 1;
    expect(isSubDone(record, sub, later)).toBe(false); // sync spawn still pending while the parent works
    apply('main', assistantLine([text('fim')], 500, { stopReason: 'end_turn' }));
    expect(isSubDone(record, sub, later)).toBe(true);
  });

  test('closing the session finishes every subagent', () => {
    const { record, sub, apply } = setup();
    apply('sub', assistantLine([toolUse('r', 'Read', { file_path: '/a' })], 10));
    record.closedAt = T0 + 100;
    expect(isSubDone(record, sub, T0 + 101)).toBe(true);
  });

  test('done subagents linger briefly, then disappear; already-old ones never appear', () => {
    const { record, sub, apply } = setup();
    apply('main', assistantLine([toolUse('tu1', 'Agent', { description: 'x' })], 0), toolResultLine('tu1', 'ok', 100));
    apply('sub', assistantLine([toolUse('r', 'Read', { file_path: '/a' })], 50));
    expect(subVisible(record, sub, T0 + 200)).toBe(true);
    expect(subVisible(record, sub, T0 + 200 + LEAVE_LINGER_MS - 1)).toBe(true);
    expect(subVisible(record, sub, T0 + 200 + LEAVE_LINGER_MS + 1)).toBe(false);

    const old = createSubRecord(record, 'old', { toolUseId: 'tu1' });
    old.state.apply(parseLine(assistantLine([text('x')], -600_000)) as ParsedLine);
    expect(subVisible(record, old, T0)).toBe(false);
  });
});
