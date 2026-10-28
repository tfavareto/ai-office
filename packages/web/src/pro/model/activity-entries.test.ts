import { describe, expect, it } from 'vitest';
import { activity, agent } from '../../test/fixtures';
import { ActivityEntryCache, NO_RESULT, activityEntries, headPrompt } from './activity-entries';

const DONE = { pendingLast: false, result: NO_RESULT };

describe('activityEntries', () => {
  it('turns tool activities into tool calls and the rest into prompts, thinking and answers', () => {
    // Arrange
    const activities = [
      activity({ id: '1', kind: 'prompt', text: 'Nova tarefa', detail: 'fix the cart' }),
      activity({ id: '2', kind: 'think', text: 'Pensando' }),
      activity({ id: '3', kind: 'read', detail: '/repo/src/a.ts' }),
      activity({ id: '4', kind: 'reply', text: 'Respondendo', detail: 'Done.' }),
    ];

    // Act
    const entries = activityEntries(activities, DONE);

    // Assert
    expect(entries.map((entry) => entry.kind)).toEqual(['user', 'thinking', 'tool', 'assistant']);
    expect(entries[0]).toMatchObject({ text: 'fix the cart' });
    expect(entries[2]).toMatchObject({ name: 'Read', input: { detail: '/repo/src/a.ts' }, result: '' });
  });

  it('attaches an error to the call it belongs to, as a red result under it', () => {
    // Arrange
    const activities = [
      activity({ id: '1', kind: 'bash', detail: 'npm test' }),
      activity({ id: '2', kind: 'error', text: 'Erro em Bash', detail: '3 tests failed', error: true }),
    ];

    // Act
    const entries = activityEntries(activities, DONE);

    // Assert
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'tool', name: 'Bash', result: '3 tests failed', error: true });
  });

  it('leaves the newest call of a working agent without a result (still running)', () => {
    // Arrange
    const activities = [activity({ id: '1', kind: 'read' }), activity({ id: '2', kind: 'bash', detail: 'npm test' })];

    // Act
    const entries = activityEntries(activities, { pendingLast: true, result: () => 'ok' });

    // Assert
    expect(entries[0]).toMatchObject({ result: 'ok' });
    expect(entries[1]).not.toHaveProperty('result');
  });

  it('writes a delegation with its description, not the activity sentence', () => {
    // Arrange
    const delegation = activity({
      id: '1',
      kind: 'subagent',
      text: 'Delegando: Mapear',
      msg: { key: 'activity.subagent', params: { description: 'Mapear os módulos' } },
    });

    // Act
    const [entry] = activityEntries([delegation], DONE);

    // Assert
    expect(entry).toMatchObject({ name: 'Task', input: { detail: 'Mapear os módulos' } });
  });
});

describe('headPrompt', () => {
  it('starts with the task as a prompt unless the activities already do', () => {
    // Arrange
    const sub = agent({ kind: 'sub', title: 'Map the modules', startedAt: 5 });

    // Act
    const head = headPrompt(sub, activity({ kind: 'read' }));
    const none = headPrompt(sub, activity({ kind: 'prompt' }));

    // Assert
    expect(head).toEqual({ kind: 'user', at: 5, text: 'Map the modules' });
    expect(none).toBeUndefined();
  });
});

describe('ActivityEntryCache', () => {
  it('keeps the same entry objects while nothing changes, so only new lines are drawn', () => {
    // Arrange
    const cache = new ActivityEntryCache();
    const owner = agent({ title: undefined });
    const first = [activity({ id: '1', kind: 'read' })];
    const before = cache.entries(owner, first, DONE);

    // Act
    const same = cache.entries(owner, [...first], DONE);
    const grown = cache.entries(owner, [...first, activity({ id: '2', kind: 'edit', at: 2000 })], DONE);

    // Assert
    expect(same).toBe(before);
    expect(grown[0]).toBe(before[0]);
    expect(grown).toHaveLength(2);
  });
});
