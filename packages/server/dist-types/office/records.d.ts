import type { Account, PersonName } from '@ai-office/shared';
import type { RegistryEntry } from '../claude/registry';
import type { SubagentMeta } from '../claude/paths';
import { TranscriptState } from '../claude/transcript-state';
/** Subagent without events for this long counts as finished (when its parent is idle, or it runs in the background). */
export declare const SUB_IDLE_DONE_MS = 120000;
/** Done subagents and closed sessions stay visible this long so the office can animate them leaving. */
export declare const LEAVE_LINGER_MS = 6000;
/** Without a registry, a session with no events for this long has left. */
export declare const NO_REGISTRY_SESSION_MS: number;
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
export declare function sessionKey(accountId: string, sessionId: string): string;
export declare function createSessionRecord(account: Account, sessionId: string, registry: RegistryEntry | undefined, registryMode: boolean, now: number): SessionRecord;
export declare function createSubRecord(record: SessionRecord, agentId: string, meta: SubagentMeta | undefined): SubRecord;
/** Replaces a transcript state with an empty one (the file was truncated or replaced). */
export declare function resetTranscript(record: SessionRecord, sub: SubRecord | undefined): void;
/** Project folder of a session: the registry cwd, else the cwd seen in the transcript. */
export declare function projectPathOf(record: SessionRecord): string | undefined;
/** Decides whether a subagent finished (see the lifecycle rules in the server spec). */
export declare function isSubDone(record: SessionRecord, sub: SubRecord, now: number): boolean;
/** Updates `doneAt` the first time a subagent is seen as done; returns whether it should still be shown. */
export declare function subVisible(record: SessionRecord, sub: SubRecord, now: number): boolean;
