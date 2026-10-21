import type { Agent, TaskItem } from '@ai-office/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { account, agent, project, snapshot } from '../../test/fixtures';
import {
  boardOptions,
  buildBoard,
  buildCards,
  DONE_PER_ROOM,
  NO_FILTER,
  sanitizeFilter,
  type BoardView,
} from './board';
import type { SentMark } from './board-moves';

const task = (id: string, status: TaskItem['status'], patch: Partial<TaskItem> = {}): TaskItem => ({
  id,
  title: `Task ${id}`,
  status,
  ...patch,
});
const COLUMN_VIEW: BoardView = { grouping: 'column', showAllDone: false };

/** Two rooms: "loja" (order 0) with Ana and Bia, "api" (order 1) with Caio on another account. */
function office(patch: { ana?: Partial<Agent>; bia?: Partial<Agent>; caio?: Partial<Agent> } = {}) {
  return snapshot({
    accounts: [account({ id: 'acc1' }), account({ id: 'acc2', label: 'Trabalho' })],
    projects: [project({ id: 'p1', name: 'loja', order: 0 }), project({ id: 'p2', name: 'api', order: 1 })],
    agents: [
      agent({
        id: 'ana',
        name: 'Ana',
        projectId: 'p1',
        startedAt: 1,
        tasks: [task('1', 'completed'), task('2', 'in_progress', { activeForm: 'Doing 2' }), task('3', 'pending')],
        ...patch.ana,
      }),
      agent({
        id: 'bia',
        name: 'Bia',
        projectId: 'p1',
        startedAt: 2,
        status: 'idle',
        tasks: [task('1', 'pending')],
        ...patch.bia,
      }),
      agent({
        id: 'caio',
        name: 'Caio',
        projectId: 'p2',
        accountId: 'acc2',
        startedAt: 3,
        tasks: [task('1', 'in_progress')],
        ...patch.caio,
      }),
    ],
  });
}

afterEach(() => setLocale('pt-BR'));

describe('buildCards', () => {
  it('turns every task into a card in room then agent order, with the doing form while in progress', () => {
    const cards = buildCards(office());

    expect(cards.map((card) => card.key)).toEqual(['ana:1', 'ana:2', 'ana:3', 'bia:1', 'caio:1']);
    expect(cards.find((card) => card.key === 'ana:2')).toMatchObject({
      label: 'Doing 2',
      title: 'Task 2',
      projectId: 'p1',
      accountId: 'acc1',
      status: 'in_progress',
      index: 1,
    });
    expect(cards.find((card) => card.key === 'ana:3')?.label).toBe('Task 3');
  });

  it('renders demo task titles in the current language', () => {
    const demo = snapshot({
      agents: [
        agent({
          tasks: [
            task('1', 'in_progress', {
              title: 'Implementar a mudança',
              titleMsg: { key: 'demo.task.2.title' },
              activeForm: 'Implementando a mudança',
              activeFormMsg: { key: 'demo.task.2.active' },
            }),
          ],
        }),
      ],
    });

    setLocale('en');
    const [card] = buildCards(demo);

    expect(card?.label).toBe('Implementing the change');
    expect(card?.title).toBe('Implement the change');
  });

  it('leaves out the tasks of agents that left the office and keeps the change stamp', () => {
    const gone = office({ caio: { status: 'offline' }, ana: { tasks: [task('1', 'pending', { changedAt: 77 })] } });

    const cards = buildCards(gone);

    expect(cards.map((card) => card.key)).toEqual(['ana:1', 'bia:1']);
    expect(cards[0]?.changedAt).toBe(77);
    expect(buildCards(null)).toEqual([]);
  });
});

describe('buildBoard columns', () => {
  it('splits the cards into pending, in progress and completed over all rooms', () => {
    const board = buildBoard(office(), NO_FILTER, COLUMN_VIEW);

    expect(board.columns.map((column) => [column.id, column.cards.map((card) => card.key)])).toEqual([
      ['pending', ['ana:3', 'bia:1']],
      ['in_progress', ['ana:2', 'caio:1']],
      ['completed', ['ana:1']],
    ]);
    expect(board.total).toBe(5);
    expect(board.columns.map((column) => column.total)).toEqual([2, 2, 1]);
  });

  it('keeps one lane per room with its own columns', () => {
    const board = buildBoard(office(), NO_FILTER, { grouping: 'room', showAllDone: false });

    expect(board.lanes.map((lane) => lane.project.name)).toEqual(['loja', 'api']);
    expect(board.lanes[1]?.columns.map((column) => column.cards.length)).toEqual([0, 1, 0]);
    expect(board.lanes[0]?.agents.map((a) => a.name)).toEqual(['Ana', 'Bia']);
  });

  it('lists main agents without tasks so the board can say they have no list', () => {
    const board = buildBoard(office({ bia: { tasks: [] } }), NO_FILTER, COLUMN_VIEW);

    expect(board.taskless.map((a) => a.name)).toEqual(['Bia']);
  });

  it('counts the tasks of a subagent for its main agent', () => {
    const withSub = office();
    withSub.agents.push(
      agent({ id: 'sub', kind: 'sub', parentId: 'bia', projectId: 'p1', startedAt: 9, tasks: [task('1', 'pending')] }),
    );

    const board = buildBoard(withSub, { ...NO_FILTER, agentId: 'bia' }, COLUMN_VIEW);

    expect(board.columns[0]?.cards.map((card) => card.key)).toEqual(['bia:1', 'sub:1']);
    expect(board.taskless).toEqual([]);
  });

  it('is empty, not broken, without a snapshot', () => {
    const board = buildBoard(null, NO_FILTER, COLUMN_VIEW);

    expect(board.total).toBe(0);
    expect(board.columns).toHaveLength(3);
  });
});

describe('buildBoard filters', () => {
  it('filters by room, account and agent', () => {
    const base = office();

    const byRoom = buildBoard(base, { ...NO_FILTER, roomId: 'p2' }, COLUMN_VIEW);
    const byAccount = buildBoard(base, { ...NO_FILTER, accountId: 'acc1' }, COLUMN_VIEW);
    const byAgent = buildBoard(base, { ...NO_FILTER, agentId: 'bia' }, COLUMN_VIEW);

    expect(byRoom.total).toBe(1);
    expect(byAccount.total).toBe(4);
    expect(byAgent.columns[0]?.cards.map((card) => card.key)).toEqual(['bia:1']);
  });

  it('"only active" keeps agents that work, wait for you or run a shell', () => {
    const base = office();
    base.agents.push(
      agent({
        id: 'dan',
        name: 'Dan',
        projectId: 'p1',
        startedAt: 4,
        status: 'waiting',
        tasks: [task('1', 'pending')],
      }),
    );

    const board = buildBoard(base, { ...NO_FILTER, onlyActive: true }, COLUMN_VIEW);

    expect(board.columns[0]?.cards.map((card) => card.key)).toEqual(['ana:3', 'dan:1']);
    expect(board.taskless).toEqual([]);
  });

  it('options list rooms and accounts with people, and the main agents of the chosen room', () => {
    const base = office({ caio: { status: 'offline' } });

    const all = boardOptions(base, NO_FILTER);
    const inRoom = boardOptions(base, { ...NO_FILTER, roomId: 'p1' });

    expect(all.rooms.map((room) => room.id)).toEqual(['p1']);
    expect(all.accounts).toEqual(['acc1']);
    expect(inRoom.agents.map((a) => a.id)).toEqual(['ana', 'bia']);
  });

  it('drops filter choices that no longer exist and keeps the same object when nothing changed', () => {
    const base = office({ caio: { status: 'offline' } });
    const stale = { roomId: 'p2', accountId: 'acc2', agentId: 'caio', onlyActive: true };
    const fine = { ...NO_FILTER, roomId: 'p1' };

    expect(sanitizeFilter(stale, base)).toEqual({ ...NO_FILTER, onlyActive: true });
    expect(sanitizeFilter(fine, base)).toBe(fine);
  });
});

describe('completed collapse', () => {
  const manyDone = (): ReturnType<typeof office> =>
    office({ ana: { tasks: [1, 2, 3, 4, 5].map((n) => task(String(n), 'completed', { changedAt: n * 1000 })) } });

  it('shows only the last few completed cards per room, newest first, and counts the hidden ones', () => {
    const board = buildBoard(manyDone(), NO_FILTER, COLUMN_VIEW);
    const done = board.columns[2];

    expect(done?.cards.map((card) => card.key)).toEqual(['ana:5', 'ana:4', 'ana:3']);
    expect(done?.cards).toHaveLength(DONE_PER_ROOM);
    expect(done).toMatchObject({ total: 5, hidden: 2 });
    expect(board.hiddenDone).toBe(2);
  });

  it('shows all of them on request', () => {
    const board = buildBoard(manyDone(), NO_FILTER, { grouping: 'column', showAllDone: true });

    expect(board.columns[2]?.cards).toHaveLength(5);
    expect(board.hiddenDone).toBe(0);
  });

  it('applies the limit to each room separately, also in lanes', () => {
    const rooms = manyDone();
    rooms.agents.push(
      agent({
        id: 'eva',
        projectId: 'p2',
        startedAt: 8,
        tasks: [task('1', 'completed', { changedAt: 9000 }), task('2', 'completed', { changedAt: 1 })],
      }),
    );

    const board = buildBoard(rooms, NO_FILTER, { grouping: 'room', showAllDone: false });

    expect(board.lanes[0]?.columns[2]).toMatchObject({ hidden: 2 });
    expect(board.lanes[1]?.columns[2]).toMatchObject({ hidden: 0 });
    expect(board.columns[2]?.cards.map((card) => card.key)).toEqual(['eva:1', 'ana:5', 'ana:4', 'ana:3', 'eva:2']);
  });

  it('falls back to list order when tasks carry no stamp', () => {
    const plain = office({
      ana: { tasks: [task('1', 'completed'), task('2', 'completed'), task('3', 'completed'), task('4', 'completed')] },
    });

    const board = buildBoard(plain, NO_FILTER, COLUMN_VIEW);

    expect(board.columns[2]?.cards.map((card) => card.key)).toEqual(['ana:4', 'ana:3', 'ana:2']);
  });
});

describe('sent marks', () => {
  const mark = (patch: Partial<SentMark>): SentMark => ({
    id: 'm1',
    kind: 'start',
    agentId: 'bia',
    title: 'Task 1',
    column: 'in_progress',
    sentAt: 1,
    ...patch,
  });

  it('decorates the card a message is about', () => {
    const board = buildBoard(office(), NO_FILTER, COLUMN_VIEW, [mark({ cardKey: 'bia:1', baseStatus: 'pending' })]);

    expect(board.columns[0]?.cards.find((card) => card.key === 'bia:1')?.sent?.id).toBe('m1');
    expect(board.columns[0]?.cards.find((card) => card.key === 'ana:3')?.sent).toBeUndefined();
  });

  it('adds a ghost card for a requested task that the agent has not written down yet', () => {
    const board = buildBoard(office(), NO_FILTER, COLUMN_VIEW, [
      mark({ id: 'g1', kind: 'add', agentId: 'ana', title: 'Write docs', column: 'pending' }),
    ]);

    const ghost = board.columns[0]?.cards.find((card) => card.ghost);
    expect(ghost).toMatchObject({ key: 'ghost:g1', agentId: 'ana', label: 'Write docs', status: 'pending' });
    expect(board.total).toBe(5);
    expect(board.columns[0]?.total).toBe(3);
  });

  it('hides the ghost card of an agent the filter leaves out', () => {
    const board = buildBoard(office(), { ...NO_FILTER, roomId: 'p2' }, COLUMN_VIEW, [
      mark({ id: 'g1', kind: 'add', agentId: 'ana', title: 'Write docs', column: 'pending' }),
    ]);

    expect(board.columns.flatMap((column) => column.cards).some((card) => card.ghost)).toBe(false);
  });
});
