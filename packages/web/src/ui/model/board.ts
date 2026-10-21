// Task board model: the tasks of every agent as cards in three columns (or in one lane per room), with filters,
// ordering and the collapse of old completed cards. Pure: the panel only draws what `buildBoard` returns.
import type { Agent, OfficeSnapshot, Project, TaskItem } from '@ai-office/shared';
import { compareBoardAgents, isBoardAgent } from '../../world/taskBoard';
import { taskLabel, taskTitle } from '../display';
import { displayStatus } from './status';
import type { SentMark } from './board-moves';

export type BoardColumnId = TaskItem['status'];
export type BoardGrouping = 'column' | 'room';

export const BOARD_COLUMNS: readonly BoardColumnId[] = ['pending', 'in_progress', 'completed'];

/** Completed cards each room keeps visible until "see all" is chosen. */
export const DONE_PER_ROOM = 3;

export interface BoardCard {
  /** `${agentId}:${taskId}`: unique on the board. */
  key: string;
  agentId: string;
  taskId: string;
  projectId: string;
  accountId: string;
  status: BoardColumnId;
  /** What the card says: the "doing…" form while in progress, otherwise the title (current language). */
  label: string;
  /** The title alone (current language), as used in messages. */
  title: string;
  /** Epoch ms when the task entered its status, when known. */
  changedAt?: number;
  /** Position in the agent's own list. */
  index: number;
  /** A message about this card was sent and the snapshot has not reflected it yet. */
  sent?: SentMark;
  /** Not a task yet: the "add this task" message was sent and the agent has not written it down. */
  ghost?: boolean;
}

export interface BoardFilter {
  roomId: string | null;
  accountId: string | null;
  /** A main agent (its subagents' tasks come with it). */
  agentId: string | null;
  /** Only agents that are working, waiting for you or running a shell. */
  onlyActive: boolean;
}

export const NO_FILTER: BoardFilter = { roomId: null, accountId: null, agentId: null, onlyActive: false };

export interface BoardView {
  grouping: BoardGrouping;
  /** Show every completed card instead of the last few per room. */
  showAllDone: boolean;
}

export interface BoardColumn {
  id: BoardColumnId;
  cards: BoardCard[];
  /** Cards of the column after filtering, including the collapsed ones. */
  total: number;
  /** Completed cards folded away by the collapse. */
  hidden: number;
}

export interface BoardLane {
  project: Project;
  columns: BoardColumn[];
  /** Main agents of the room that match the filter. */
  agents: Agent[];
}

export interface BoardModel {
  grouping: BoardGrouping;
  /** The three columns over all rooms (used when grouped by column). */
  columns: BoardColumn[];
  /** One lane per room, in room order (used when grouped by room). */
  lanes: BoardLane[];
  total: number;
  hiddenDone: number;
  /** Main agents matching the filter that have no tasks (real sessions only list what Claude Code writes). */
  taskless: Agent[];
}

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['working', 'waiting', 'shell']);

function cardOf(agent: Agent, task: TaskItem, index: number): BoardCard {
  return {
    key: `${agent.id}:${task.id}`,
    agentId: agent.id,
    taskId: task.id,
    projectId: agent.projectId,
    accountId: agent.accountId,
    status: task.status,
    label: taskLabel(task),
    title: taskTitle(task),
    ...(task.changedAt !== undefined ? { changedAt: task.changedAt } : {}),
    index,
  };
}

/** Every task of every agent in the office, in board order (unfiltered, no marks). */
export function buildCards(snapshot: OfficeSnapshot | null): BoardCard[] {
  if (!snapshot) return [];
  const agents = snapshot.agents.filter(isBoardAgent).sort(compareBoardAgents(snapshot.projects));
  return agents.flatMap((agent) => agent.tasks.map((task, index) => cardOf(agent, task, index)));
}

function mainOf(agent: Agent): string {
  return agent.kind === 'sub' ? (agent.parentId ?? agent.id) : agent.id;
}

/** Whether an agent's tasks pass the filter. */
export function agentPasses(agent: Agent, filter: BoardFilter): boolean {
  if (filter.roomId !== null && agent.projectId !== filter.roomId) return false;
  if (filter.accountId !== null && agent.accountId !== filter.accountId) return false;
  if (filter.agentId !== null && mainOf(agent) !== filter.agentId) return false;
  return !filter.onlyActive || ACTIVE_STATUSES.has(displayStatus(agent));
}

/** Newest first; cards without a stamp fall back to their place in the agent's list (later = newer). */
function byRecency(a: BoardCard, b: BoardCard): number {
  return (b.changedAt ?? 0) - (a.changedAt ?? 0) || b.index - a.index;
}

function ghostCard(mark: SentMark, agent: Agent): BoardCard {
  return {
    key: `ghost:${mark.id}`,
    agentId: agent.id,
    taskId: mark.id,
    projectId: agent.projectId,
    accountId: agent.accountId,
    status: mark.column,
    label: mark.title,
    title: mark.title,
    index: Number.MAX_SAFE_INTEGER,
    sent: mark,
    ghost: true,
  };
}

function makeColumn(id: BoardColumnId, cards: BoardCard[], hidden = 0): BoardColumn {
  return { id, cards, total: cards.length + hidden, hidden };
}

/** Splits one room's cards into the three columns, folding old completed ones unless `showAllDone`. */
function roomColumns(cards: readonly BoardCard[], showAllDone: boolean): BoardColumn[] {
  return BOARD_COLUMNS.map((id) => {
    const inColumn = cards.filter((card) => card.status === id);
    if (id !== 'completed') return makeColumn(id, inColumn);
    const sorted = [...inColumn].sort(byRecency);
    const visible = showAllDone ? sorted : sorted.slice(0, DONE_PER_ROOM);
    return makeColumn(id, visible, sorted.length - visible.length);
  });
}

function mergeColumns(lanes: readonly BoardLane[]): BoardColumn[] {
  return BOARD_COLUMNS.map((id, position) => {
    const parts = lanes.map((lane) => lane.columns[position] as BoardColumn);
    const cards = parts.flatMap((part) => part.cards);
    return makeColumn(
      id,
      id === 'completed' ? [...cards].sort(byRecency) : cards,
      parts.reduce((sum, part) => sum + part.hidden, 0),
    );
  });
}

/**
 * The board for a snapshot. `sent` marks decorate the cards they are about (and add ghost cards for requested tasks
 * that do not exist yet). Columns count what passes the filter; completed cards beyond the last few per room fold away.
 */
export function buildBoard(
  snapshot: OfficeSnapshot | null,
  filter: BoardFilter,
  view: BoardView,
  sent: readonly SentMark[] = [],
): BoardModel {
  if (!snapshot)
    return {
      grouping: view.grouping,
      columns: roomColumns([], true),
      lanes: [],
      total: 0,
      hiddenDone: 0,
      taskless: [],
    };
  const agents = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const passing = new Set(
    snapshot.agents.filter((agent) => isBoardAgent(agent) && agentPasses(agent, filter)).map((agent) => agent.id),
  );
  const marks = new Map(
    sent.filter((mark) => mark.cardKey !== undefined).map((mark) => [mark.cardKey as string, mark]),
  );
  const cards = buildCards(snapshot)
    .filter((card) => passing.has(card.agentId))
    .map((card) => (marks.has(card.key) ? { ...card, sent: marks.get(card.key) } : card));
  const ghosts = sent.flatMap((mark) => {
    const agent = mark.kind === 'add' ? agents.get(mark.agentId) : undefined;
    return agent && passing.has(agent.id) ? [ghostCard(mark, agent)] : [];
  });

  const mains = snapshot.agents
    .filter((agent) => agent.kind === 'main' && passing.has(agent.id))
    .sort(compareBoardAgents(snapshot.projects));
  const withTasks = new Set(cards.map((card) => mainOf(agents.get(card.agentId) as Agent)));
  const lanes = [...snapshot.projects]
    .sort((a, b) => a.order - b.order)
    .flatMap((project): BoardLane[] => {
      const laneAgents = mains.filter((agent) => agent.projectId === project.id);
      const laneCards = [...cards, ...ghosts].filter((card) => card.projectId === project.id);
      if (laneAgents.length === 0 && laneCards.length === 0) return [];
      return [{ project, columns: roomColumns(laneCards, view.showAllDone), agents: laneAgents }];
    });
  const columns = mergeColumns(lanes);
  return {
    grouping: view.grouping,
    columns,
    lanes,
    total: cards.length,
    hiddenDone: columns.reduce((sum, column) => sum + column.hidden, 0),
    taskless: mains.filter((agent) => !withTasks.has(agent.id)),
  };
}

export interface BoardOptions {
  rooms: Project[];
  accounts: string[];
  /** Main agents in the office, in board order. */
  agents: Agent[];
}

/** Choices for the filter menus: rooms and accounts with someone in them, and the main agents (of the chosen room). */
export function boardOptions(snapshot: OfficeSnapshot | null, filter: BoardFilter): BoardOptions {
  if (!snapshot) return { rooms: [], accounts: [], agents: [] };
  const present = snapshot.agents.filter(isBoardAgent);
  const roomIds = new Set(present.map((agent) => agent.projectId));
  const accountIds = new Set(present.map((agent) => agent.accountId));
  const mains = present.filter(
    (agent) => agent.kind === 'main' && (filter.roomId === null || agent.projectId === filter.roomId),
  );
  return {
    rooms: snapshot.projects.filter((project) => roomIds.has(project.id)).sort((a, b) => a.order - b.order),
    accounts: snapshot.accounts.map((account) => account.id).filter((id) => accountIds.has(id)),
    agents: mains.sort(compareBoardAgents(snapshot.projects)),
  };
}

/** Drops filter choices that no longer exist (a room closed, an agent left) so the board never filters on a ghost. */
export function sanitizeFilter(filter: BoardFilter, snapshot: OfficeSnapshot | null): BoardFilter {
  const present = (snapshot?.agents ?? []).filter(isBoardAgent);
  const rooms = new Set(present.map((agent) => agent.projectId));
  const accounts = new Set(present.map((agent) => agent.accountId));
  const agents = new Set(present.map((agent) => agent.id));
  const next: BoardFilter = {
    ...filter,
    roomId: filter.roomId !== null && rooms.has(filter.roomId) ? filter.roomId : null,
    accountId: filter.accountId !== null && accounts.has(filter.accountId) ? filter.accountId : null,
    agentId: filter.agentId !== null && agents.has(filter.agentId) ? filter.agentId : null,
  };
  return sameFilter(filter, next) ? filter : next;
}

export function sameFilter(a: BoardFilter, b: BoardFilter): boolean {
  return (
    a.roomId === b.roomId && a.accountId === b.accountId && a.agentId === b.agentId && a.onlyActive === b.onlyActive
  );
}
