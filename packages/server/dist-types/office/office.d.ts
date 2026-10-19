import { type Account, type Activity, type ActivityDraft, type Agent, type AccountUsage, type DemoSimulator, type FeedItem, type Notice, type PermissionRequest, type Project } from '@ai-office/shared';
import type { ParsedLine } from '../claude/types';
import type { SubagentMeta } from '../claude/paths';
import type { RegistryEntry } from '../claude/registry';
import type { ApplyEffects, UsageRecord } from '../claude/transcript-state';
import type { Logger } from '../log';
import type { NameStore } from './name-store';
import { type SessionRecord, type SubRecord } from './records';
export interface OfficeOverlays {
    permissionFor(agentId: string): PermissionRequest | undefined;
    attentionFor(agentId: string): string | undefined;
}
export interface OfficeEvents {
    onChange(): void;
    onFeed(items: FeedItem[]): void;
    onNotice(notice: Notice): void;
    /** Live transcript event of an agent (used to cancel stale permission requests and attention marks). */
    onAgentEvent(agentId: string, effects: ApplyEffects, at: number): void;
    onUsage(accountId: string, record: UsageRecord): void;
}
export interface OfficeDeps {
    now: () => number;
    names: NameStore;
    log: Logger;
    overlays: OfficeOverlays;
    events: OfficeEvents;
}
export interface OfficeState {
    accounts: Account[];
    projects: Project[];
    agents: Agent[];
    /** Usage of demo accounts (empty when demo is off). */
    demoUsage: AccountUsage[];
}
export declare class Office {
    private readonly deps;
    private accounts;
    private readonly records;
    private readonly memo;
    private readonly projectOrders;
    private readonly announce;
    private readonly lastErrorNotice;
    private feedBacklog;
    private demo;
    private lastFingerprint;
    private computed;
    constructor(deps: OfficeDeps);
    setAccounts(accounts: Account[]): void;
    setDemo(simulator: DemoSimulator | undefined): void;
    get demoSimulator(): DemoSimulator | undefined;
    trackSession(account: Account, sessionId: string, registry: RegistryEntry | undefined, registryMode: boolean, announce: boolean): SessionRecord;
    record(key: string): SessionRecord | undefined;
    sessions(): IterableIterator<SessionRecord>;
    closeSession(key: string, announce: boolean): void;
    ensureSub(record: SessionRecord, agentId: string, meta: SubagentMeta | undefined): SubRecord;
    /** Applies parsed lines to a session (main when `subAgentId` is undefined). Lines older than `replayBefore` are history. */
    ingest(record: SessionRecord, sub: SubRecord | undefined, lines: readonly ParsedLine[], replayBefore: number): void;
    /** Records an activity that does not come from a transcript (message delivered, permission requested). */
    addExternalActivity(agentId: string, draft: ActivityDraft): Activity | undefined;
    tickDemo(now: number): void;
    state(): OfficeState;
    recentFeed(): FeedItem[];
    agentById(id: string): Agent | undefined;
    /** Finds the agent a hook refers to: raw session id plus the optional raw subagent id. */
    findAgent(sessionId: string, rawAgentId?: string): Agent | undefined;
    /** Long activity history of an agent (real or demo). */
    history(agentId: string): Activity[] | undefined;
    locate(agentId: string): {
        record: SessionRecord;
        sub: SubRecord | undefined;
    } | undefined;
    /** Recomputes agents and projects; fires `onChange` when anything visible changed. */
    refresh(now: number): void;
    private compute;
    private collect;
    private projectsFor;
    private withStatusSince;
    private alertWaiting;
    private takenNames;
    private personOf;
    private noticesFor;
    private notice;
    private publishFeed;
}
