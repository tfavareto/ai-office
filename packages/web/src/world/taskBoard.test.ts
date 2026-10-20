import type { TaskItem } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { agent, project } from '../test/fixtures';
import { compareBoardAgents, EMPTY_TASK_BOARD, isBoardAgent, summarizeTaskBoard, taskBoardKey } from './taskBoard';

const task = (id: string, status: TaskItem['status'], patch: Partial<TaskItem> = {}): TaskItem => ({ id, title: `Task ${id}`, status, ...patch });

describe('summarizeTaskBoard', () => {
  it('counts the tasks of every agent per column', () => {
    const agents = [
      agent({ id: 'a', tasks: [task('1', 'pending'), task('2', 'in_progress'), task('3', 'completed')] }),
      agent({ id: 'b', tasks: [task('1', 'pending'), task('2', 'completed')] }),
    ];

    const summary = summarizeTaskBoard(agents, [project()]);

    expect(summary).toMatchObject({ pending: 2, active: 1, done: 2 });
  });

  it('ignores the tasks of agents that left the office', () => {
    const agents = [agent({ id: 'a', status: 'offline', tasks: [task('1', 'in_progress')] }), agent({ id: 'b', status: 'done', tasks: [task('1', 'pending')] })];

    expect(summarizeTaskBoard(agents, [project()])).toEqual(EMPTY_TASK_BOARD);
  });

  it('lists at most three in-progress titles, using the doing form, in room then arrival order', () => {
    const projects = [project({ id: 'p1', order: 1 }), project({ id: 'p2', order: 0 })];
    const agents = [
      agent({ id: 'late', projectId: 'p1', startedAt: 5, tasks: [task('1', 'in_progress', { activeForm: 'Doing late' })] }),
      agent({ id: 'early', projectId: 'p2', startedAt: 9, tasks: [task('1', 'in_progress', { title: 'Plain title' }), task('2', 'in_progress', { activeForm: 'Doing two', activeFormMsg: { key: 'demo.task.1.active' } })] }),
      agent({ id: 'extra', projectId: 'p1', startedAt: 7, tasks: [task('1', 'in_progress')] }),
    ];

    const summary = summarizeTaskBoard(agents, projects);

    expect(summary.active).toBe(4);
    expect(summary.top.map((title) => title.text)).toEqual(['Plain title', 'Doing two', 'Doing late']);
    expect(summary.top[1]?.msg).toEqual({ key: 'demo.task.1.active' });
  });
});

describe('taskBoardKey', () => {
  it('changes with the numbers and with the titles', () => {
    const base = summarizeTaskBoard([agent({ tasks: [task('1', 'in_progress')] })], [project()]);
    const other = summarizeTaskBoard([agent({ tasks: [task('1', 'in_progress', { title: 'Other' })] })], [project()]);
    const more = summarizeTaskBoard([agent({ tasks: [task('1', 'in_progress'), task('2', 'pending')] })], [project()]);

    expect(new Set([taskBoardKey(base), taskBoardKey(other), taskBoardKey(more)]).size).toBe(3);
  });
});

describe('board agents', () => {
  it('knows who is still in the office', () => {
    expect(isBoardAgent(agent({ status: 'idle' }))).toBe(true);
    expect(isBoardAgent(agent({ status: 'offline' }))).toBe(false);
  });

  it('sorts by room arrival, then agent arrival', () => {
    const compare = compareBoardAgents([project({ id: 'p1', order: 1 }), project({ id: 'p2', order: 0 })]);
    const sorted = [agent({ id: 'x', projectId: 'p1', startedAt: 1 }), agent({ id: 'y', projectId: 'p2', startedAt: 9 }), agent({ id: 'z', projectId: 'p1', startedAt: 0 })].sort(compare);

    expect(sorted.map((a) => a.id)).toEqual(['y', 'z', 'x']);
  });
});
