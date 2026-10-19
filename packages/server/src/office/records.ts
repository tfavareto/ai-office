// In-memory records of tracked sessions and their subagents, plus the subagent lifecycle rules.
import type { Account, PersonName } from '@ai-office/shared';
import type { RegistryEntry } from '../claude/registry';
import type { SubagentMeta } from '../claude/paths';
import { TranscriptState } from '../claude/transcript-state';

/** Subagent without events for this long counts as finished (when its parent is idle, or it runs in the background). */
export const SUB_IDLE_DONE_MS = 120_000;
/** Subagent that ended its own turn is done after this grace period. */
const SUB_END_TURN_GRACE_MS = 4000;
const REVIVE_MARGIN_MS = 3000;
/** Done subagents and closed sessions stay visible this long so the office can animate them leaving. */
export const LEAVE_LINGER_MS = 6000;
/** A subagent already done this long ago when first seen never appears. */
const STALE_DONE_MS = 60_000;
/** Without a registry, a session with no events for this long has left. */
export const NO_REGISTRY_SESSION_MS = 30 * 60_000;

export interface SubRecord {
  agentId: string;
  meta: SubagentMeta | undefined;
  state: TranscriptState;
  person: PersonName | undefined;
  doneAt: number | undefined;
}

export interface SessionRecord {
  key: string;
  account: Account;
  sessionId: string;
  registry: RegistryEntry | undefined;
  /** The account writes a session registry, so closing is decided by it. */
  registryMode: boolean;
  main: TranscriptState;
  subs: Map<string, SubRecord>;
  person: PersonName | undefined;
  openedAt: number;
  closedAt: number | undefined;
}

export function sessionKey(accountId: string, sessionId: string): string {
  return `${accountId}:${sessionId}`;
}

export function createSessionRecord(account: Account, sessionId: string, registry: RegistryEntry | undefined, registryMode: boolean, now: number): SessionRecord {
  return {
    key: sessionKey(account.id, sessionId),
    account,
    sessionId,
    registry,
    registryMode,
    main: new TranscriptState({ idPrefix: `${account.id}:${sessionId}`, isSub: false }),
    subs: new Map(),
    person: undefined,
    openedAt: now,
    closedAt: undefined,
  };
}

export function createSubRecord(record: SessionRecord, agentId: string, meta: SubagentMeta | undefined): SubRecord {
  return {
    agentId,
    meta,
    state: new TranscriptState({ idPrefix: `${record.key}:${agentId}`, isSub: true }),
    person: undefined,
    doneAt: undefined,
  };
}

/** Replaces a transcript state with an empty one (the file was truncated or replaced). */
export function resetTranscript(record: SessionRecord, sub: SubRecord | undefined): void {
  if (sub === undefined) record.main = new TranscriptState({ idPrefix: record.key, isSub: false });
  else sub.state = new TranscriptState({ idPrefix: `${record.key}:${sub.agentId}`, isSub: true });
}

/** Project folder of a session: the registry cwd, else the cwd seen in the transcript. */
export function projectPathOf(record: SessionRecord): string | undefined {
  const cwd = record.registry?.cwd;
  if (cwd !== undefined && cwd.length > 0) return cwd;
  return record.main.cwd;
}

/** A subagent that keeps working after its completion notice was resumed (e.g. continued with a new message). */
function isRevived(lastEventAt: number, doneAt: number | undefined, now: number): boolean {
  return doneAt !== undefined && lastEventAt > doneAt + REVIVE_MARGIN_MS && now - lastEventAt < SUB_IDLE_DONE_MS;
}

/** Decides whether a subagent finished (see the lifecycle rules in the server spec). */
export function isSubDone(record: SessionRecord, sub: SubRecord, now: number): boolean {
  if (record.closedAt !== undefined) return true;
  const spawn = sub.meta?.toolUseId === undefined ? undefined : record.main.spawn(sub.meta.toolUseId);
  const state = sub.state;
  if (spawn?.done === true && !isRevived(state.lastEventAt, spawn.doneAt, now)) return true;
  if (state.sawAny && state.turn === 'idle' && now - state.lastEventAt > SUB_END_TURN_GRACE_MS) return true;
  const idle = now - (state.lastEventAt > 0 ? state.lastEventAt : record.openedAt);
  if (idle <= SUB_IDLE_DONE_MS) return false;
  return spawn === undefined || spawn.async || record.main.turn === 'idle';
}

/** Updates `doneAt` the first time a subagent is seen as done; returns whether it should still be shown. */
export function subVisible(record: SessionRecord, sub: SubRecord, now: number): boolean {
  if (!isSubDone(record, sub, now)) {
    sub.doneAt = undefined;
    return true;
  }
  if (sub.doneAt === undefined) {
    const stale = sub.state.lastEventAt > 0 && now - sub.state.lastEventAt > STALE_DONE_MS;
    sub.doneAt = stale ? sub.state.lastEventAt : now;
  }
  return now - sub.doneAt < LEAVE_LINGER_MS;
}
