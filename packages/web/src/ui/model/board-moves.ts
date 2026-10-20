// Moves on the task board. The board never edits a task itself (Claude Code owns the list): a move becomes a message
// asking the right agent to change it. This module builds that message in the user's language and follows what was
// asked until a later snapshot shows the change. Pure.
import { t, type UiKey } from '../../i18n';
import type { BoardCard, BoardColumnId } from './board';

export type MoveKind = 'start' | 'complete' | 'pause' | 'reopen' | 'resume' | 'reassign' | 'add';

/** Dropping on a column changes the status; dropping on an agent hands the task over. */
export type MoveTarget = { column: BoardColumnId } | { agentId: string };

export interface MoveIntent {
  kind: MoveKind;
  /** Agent that receives the message. */
  recipientId: string;
  /** Natural text in the current language; the user may edit it before sending. */
  text: string;
  /** Task title (current language). */
  title: string;
  /** Column the card is meant to end up in. */
  column: BoardColumnId;
  /** Card the message is about (not for new tasks). */
  cardKey?: string;
  /** Status of that card when the message was built. */
  baseStatus?: BoardColumnId;
}

/** A message was sent about a card (or a new task) and no snapshot has shown the result yet. */
export interface SentMark {
  id: string;
  kind: MoveKind;
  agentId: string;
  cardKey?: string;
  title: string;
  column: BoardColumnId;
  baseStatus?: BoardColumnId;
  sentAt: number;
}

/** A mark gives up after this long: the agent may have ignored or rephrased the request. */
export const SENT_TTL_MS = 10 * 60_000;

const MESSAGE_KEYS = {
  start: 'board.msg.start',
  complete: 'board.msg.complete',
  pause: 'board.msg.pause',
  reopen: 'board.msg.reopen',
  resume: 'board.msg.resume',
  reassign: 'board.msg.reassign',
  reassignNow: 'board.msg.reassignNow',
  add: 'board.msg.add',
  addNow: 'board.msg.addNow',
  addDone: 'board.msg.addDone',
} as const satisfies Record<string, UiKey>;

type StatusMove = Partial<Record<BoardColumnId, MoveKind>>;

const STATUS_MOVES: Record<BoardColumnId, StatusMove> = {
  pending: { in_progress: 'start', completed: 'complete' },
  in_progress: { pending: 'pause', completed: 'complete' },
  completed: { pending: 'reopen', in_progress: 'resume' },
};

const ADD_KEYS: Record<BoardColumnId, 'add' | 'addNow' | 'addDone'> = { pending: 'add', in_progress: 'addNow', completed: 'addDone' };

/** The message for dropping `card` on `target`, or null when nothing would change (or the move makes no sense). */
export function buildMoveIntent(card: BoardCard, target: MoveTarget, nameOf: (agentId: string) => string): MoveIntent | null {
  if (card.ghost) return null;
  const base = { title: card.title, cardKey: card.key, baseStatus: card.status };
  if ('agentId' in target) {
    if (target.agentId === card.agentId || card.status === 'completed') return null;
    const key = card.status === 'in_progress' ? MESSAGE_KEYS.reassignNow : MESSAGE_KEYS.reassign;
    return { ...base, kind: 'reassign', recipientId: target.agentId, column: card.status, text: t(key, { task: card.title, from: nameOf(card.agentId) }) };
  }
  const kind = STATUS_MOVES[card.status][target.column];
  if (kind === undefined) return null;
  return { ...base, kind, recipientId: card.agentId, column: target.column, text: t(MESSAGE_KEYS[kind], { task: card.title }) };
}

/** The message asking `agentId` to add a task to its list (null for an empty title). */
export function buildAddIntent(agentId: string, column: BoardColumnId, rawTitle: string): MoveIntent | null {
  const title = rawTitle.trim();
  if (title.length === 0) return null;
  return { kind: 'add', recipientId: agentId, column, title, text: t(MESSAGE_KEYS[ADD_KEYS[column]], { task: title }) };
}

export function markFromIntent(intent: MoveIntent, id: string, sentAt: number): SentMark {
  return {
    id,
    kind: intent.kind,
    agentId: intent.recipientId,
    title: intent.title,
    column: intent.column,
    sentAt,
    ...(intent.cardKey !== undefined ? { cardKey: intent.cardKey } : {}),
    ...(intent.baseStatus !== undefined ? { baseStatus: intent.baseStatus } : {}),
  };
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function hasTask(cards: readonly BoardCard[], agentId: string, title: string): boolean {
  const wanted = normalizeTitle(title);
  return cards.some((card) => card.agentId === agentId && normalizeTitle(card.title) === wanted);
}

function isSettled(mark: SentMark, cards: readonly BoardCard[]): boolean {
  if (mark.kind === 'add') return hasTask(cards, mark.agentId, mark.title);
  const source = cards.find((card) => card.key === mark.cardKey);
  const moved = source === undefined || source.status !== mark.baseStatus;
  return mark.kind === 'reassign' ? moved || hasTask(cards, mark.agentId, mark.title) : moved;
}

/** Drops the marks whose change a snapshot now shows (or that waited too long). Same array when none dropped. */
export function reconcileSent(marks: readonly SentMark[], cards: readonly BoardCard[], now: number): readonly SentMark[] {
  const alive = marks.filter((mark) => now - mark.sentAt < SENT_TTL_MS && !isSettled(mark, cards));
  return alive.length === marks.length ? marks : alive;
}
