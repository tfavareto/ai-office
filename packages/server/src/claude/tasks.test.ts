import type { TaskItem } from '@ai-office/shared';
import { describe, expect, test } from 'vitest';
import { stampTaskChanges } from './tasks';

const task = (patch: Partial<TaskItem> & Pick<TaskItem, 'id'>): TaskItem => ({ title: `Task ${patch.id}`, status: 'pending', ...patch });

describe('stampTaskChanges', () => {
  test('stamps every task of a first list with the call time', () => {
    const result = stampTaskChanges([], [task({ id: '1' }), task({ id: '2', status: 'in_progress' })], 500);

    expect(result.map((item) => item.changedAt)).toEqual([500, 500]);
  });

  test('keeps the stamp of a task whose title and status did not change', () => {
    const previous = [task({ id: '1', changedAt: 100 })];

    const result = stampTaskChanges(previous, [task({ id: '1' })], 900);

    expect(result[0]?.changedAt).toBe(100);
  });

  test('restamps a task that changed status or was rewritten under the same id', () => {
    const previous = [task({ id: '1', changedAt: 100 }), task({ id: '2', changedAt: 100 })];

    const result = stampTaskChanges(previous, [task({ id: '1', status: 'completed' }), task({ id: '2', title: 'Another job' })], 900);

    expect(result.map((item) => item.changedAt)).toEqual([900, 900]);
  });

  test('stamps tasks that had no stamp yet and does not modify its input', () => {
    const previous = [task({ id: '1' })];

    const result = stampTaskChanges(previous, previous, 700);

    expect(result[0]?.changedAt).toBe(700);
    expect(previous[0]).not.toHaveProperty('changedAt');
  });
});
