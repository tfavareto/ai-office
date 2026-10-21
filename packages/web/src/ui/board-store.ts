// State of the task board panel that must survive closing it and the rebuild after a language change: filters,
// grouping, the messages still waiting to show up in a snapshot, and the task the drawer should highlight.
import {
  NO_FILTER,
  sameFilter,
  type BoardCard,
  type BoardFilter,
  type BoardGrouping,
  type BoardView,
} from './model/board';
import { reconcileSent, type SentMark } from './model/board-moves';
import { Observable } from './observable';

/** A task picked on the board; the agent drawer highlights it for a few seconds. */
export interface FocusedTask {
  agentId: string;
  taskId: string;
  at: number;
}

export interface BoardState {
  filter: BoardFilter;
  view: BoardView;
  sent: readonly SentMark[];
  focusTask: FocusedTask | null;
}

/** How long the drawer keeps a picked task highlighted. */
export const FOCUS_TASK_MS = 6000;

export class BoardStore extends Observable<BoardState> {
  private marks = 0;

  constructor() {
    super({ filter: NO_FILTER, view: { grouping: 'column', showAllDone: false }, sent: [], focusTask: null });
  }

  /** Changing the room clears the agent choice (the agent may not be in the new room). */
  setFilter(patch: Partial<BoardFilter>): void {
    const current = this.value.filter;
    const next: BoardFilter = {
      ...current,
      ...patch,
      ...('roomId' in patch && !('agentId' in patch) ? { agentId: null } : {}),
    };
    if (!sameFilter(current, next)) this.replace({ ...this.value, filter: next });
  }

  /** Replaces the filter wholesale (used to drop choices that no longer exist). */
  resetFilter(filter: BoardFilter): void {
    if (filter !== this.value.filter) this.replace({ ...this.value, filter });
  }

  setGrouping(grouping: BoardGrouping): void {
    if (grouping !== this.value.view.grouping) this.replace({ ...this.value, view: { ...this.value.view, grouping } });
  }

  toggleShowAllDone(): void {
    this.replace({ ...this.value, view: { ...this.value.view, showAllDone: !this.value.view.showAllDone } });
  }

  /** Remembers a message just sent; returns the id of its mark. */
  nextMarkId(): string {
    this.marks += 1;
    return `sent-${this.marks}`;
  }

  addSent(mark: SentMark): void {
    this.replace({ ...this.value, sent: [...this.value.sent, mark] });
  }

  /** Forgets the marks that a snapshot already shows (cheap when nothing changed). */
  reconcile(cards: readonly BoardCard[], now: number): void {
    const sent = reconcileSent(this.value.sent, cards, now);
    if (sent !== this.value.sent) this.replace({ ...this.value, sent });
  }

  focusTask(agentId: string, taskId: string, at: number): void {
    this.replace({ ...this.value, focusTask: { agentId, taskId, at } });
  }
}
