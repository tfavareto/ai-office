import { describe, expect, it, vi } from 'vitest';
import { BoardStore } from './board-store';
import { NO_FILTER, type BoardCard } from './model/board';
import type { SentMark } from './model/board-moves';

const mark = (patch: Partial<SentMark> = {}): SentMark => ({
  id: 'sent-1',
  kind: 'start',
  agentId: 'ana',
  cardKey: 'ana:1',
  baseStatus: 'pending',
  title: 'T',
  column: 'in_progress',
  sentAt: 0,
  ...patch,
});
const card: BoardCard = {
  key: 'ana:1',
  agentId: 'ana',
  taskId: '1',
  projectId: 'p1',
  accountId: 'a',
  status: 'pending',
  label: 'T',
  title: 'T',
  index: 0,
};

describe('BoardStore', () => {
  it('starts grouped by column with no filter and nothing sent', () => {
    const state = new BoardStore().get();

    expect(state).toMatchObject({
      filter: NO_FILTER,
      view: { grouping: 'column', showAllDone: false },
      sent: [],
      focusTask: null,
    });
  });

  it('clears the agent when the room changes, unless both are set together', () => {
    const store = new BoardStore();
    store.setFilter({ agentId: 'ana' });

    store.setFilter({ roomId: 'p2' });
    expect(store.get().filter).toMatchObject({ roomId: 'p2', agentId: null });

    store.setFilter({ roomId: 'p1', agentId: 'bia' });
    expect(store.get().filter).toMatchObject({ roomId: 'p1', agentId: 'bia' });
  });

  it('does not notify when a filter change changes nothing', () => {
    const store = new BoardStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setFilter({ onlyActive: false });
    store.setGrouping('column');

    expect(listener).not.toHaveBeenCalled();
  });

  it('switches grouping and the completed collapse', () => {
    const store = new BoardStore();

    store.setGrouping('room');
    store.toggleShowAllDone();

    expect(store.get().view).toEqual({ grouping: 'room', showAllDone: true });
  });

  it('hands out distinct mark ids and drops marks once the snapshot shows the change', () => {
    const store = new BoardStore();
    expect(store.nextMarkId()).not.toBe(store.nextMarkId());
    store.addSent(mark());

    store.reconcile([card], 1000);
    expect(store.get().sent).toHaveLength(1);

    store.reconcile([{ ...card, status: 'in_progress' }], 1000);
    expect(store.get().sent).toEqual([]);
  });

  it('remembers the picked task for the drawer', () => {
    const store = new BoardStore();

    store.focusTask('ana', '2', 55);

    expect(store.get().focusTask).toEqual({ agentId: 'ana', taskId: '2', at: 55 });
  });
});
