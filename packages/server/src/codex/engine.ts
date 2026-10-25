// The Codex ingest engine: finds the Codex homes, follows the rollout files written lately and feeds the Office the
// same way the Claude engine does (sessions, subagents, activities). It only reads; Codex has no hooks to talk back.
//
// Open sessions: Codex keeps no registry of running processes, so a session counts as open while its rollout file was
// written in the last CODEX_OPEN_WINDOW_MS (the same 30 minutes the Claude engine uses without a registry). It is
// "working" from `task_started` to `task_complete`, "waiting" while an approval request is unanswered, "idle" after.
import { stat } from 'node:fs/promises';
import type { Account } from '@ai-office/shared';
import { JsonlTailer } from '../claude/jsonl-tailer';
import type { ParsedLine } from '../claude/types';
import type { Logger } from '../log';
import type { Office } from '../office/office';
import {
  NO_REGISTRY_SESSION_MS,
  type SessionRecord,
  type SubRecord,
  resetTranscript,
  sessionKey,
} from '../office/records';
import { codexAccounts, codexDirs, type CodexDiscoverOptions } from './home';
import { type RolloutFile, type RolloutHead, listRollouts, readFirstRecord, readRolloutHead } from './rollouts';
import type { CodexSettingsStore } from './settings-store';
import { readThreadNames } from './thread-names';
import { RolloutTranslator } from './translate';

export const CODEX_POLL_INTERVAL_MS = 1000;
/** A session is open while its rollout file was written within this time. */
export const CODEX_OPEN_WINDOW_MS = NO_REGISTRY_SESSION_MS;
/** Lines older than this at the first read of a file are history: they do not create feed items or notices. */
const REPLAY_GRACE_MS = 15_000;
const LIST_INTERVAL_MS = 4000;
const ACCOUNT_REFRESH_MS = 10_000;
const NAMES_REFRESH_MS = 15_000;
const MAX_NEW_HEADS_PER_PASS = 40;
const MAX_SUBS_PER_SESSION = 12;

interface Followed {
  file: RolloutFile;
  tailer: JsonlTailer;
  translator: RolloutTranslator;
  /** The session_meta line has been fed (a tail that starts mid-file misses it). */
  primed: boolean;
}

interface TrackedSession extends Followed {
  record: SessionRecord;
  account: Account;
  head: RolloutHead;
  subs: Map<string, Followed>;
  name: string | undefined;
}

export interface CodexEngineDeps {
  discover: Pick<CodexDiscoverOptions, 'homeDir' | 'envDir' | 'extraDirs'>;
  office: Office;
  settings: Pick<CodexSettingsStore, 'sessions'>;
  log: Logger;
  now: () => number;
}

export class CodexEngine {
  private readonly tracked = new Map<string, TrackedSession>();
  private readonly names = new Map<string, Map<string, string>>();
  private accounts: Account[] = [];
  private accountsAt = 0;
  private listAt = 0;
  private namesAt = 0;
  private firstScan = true;
  private timer: NodeJS.Timeout | undefined;
  private scanning = false;
  private stopped = false;

  constructor(private readonly deps: CodexEngineDeps) {}

  async start(): Promise<void> {
    await this.scan();
    this.timer = setInterval(() => void this.scan(), CODEX_POLL_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  /** Codex accounts (none while the setting is off or no Codex home exists). */
  accountList(): Account[] {
    return this.accounts;
  }

  /** Open sessions per account (for /api/health). */
  sessionCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of this.tracked.values()) {
      if (item.record.closedAt === undefined) counts.set(item.account.id, (counts.get(item.account.id) ?? 0) + 1);
    }
    return counts;
  }

  /** Rollout file of an open session, or of one of its subagent threads. */
  pathOf(accountId: string, sessionId: string, threadId?: string): string | undefined {
    const item = this.tracked.get(sessionKey(accountId, sessionId));
    if (item === undefined) return undefined;
    return threadId === undefined ? item.file.path : item.subs.get(threadId)?.file.path;
  }

  /** Applies a changed setting now instead of at the next account refresh. */
  async reload(): Promise<void> {
    this.accountsAt = 0;
    await this.scan();
  }

  async scan(): Promise<void> {
    if (this.scanning || this.stopped) return;
    this.scanning = true;
    try {
      await this.scanOnce();
    } catch (error) {
      this.deps.log.debug(`Falha na leitura do Codex: ${String(error)}`);
    } finally {
      this.scanning = false;
    }
  }

  private async scanOnce(): Promise<void> {
    const now = this.deps.now();
    this.refreshAccounts(now);
    if (this.accounts.length === 0) {
      this.closeAll();
      this.deps.office.refresh(now);
      return;
    }
    if (now - this.listAt >= LIST_INTERVAL_MS || this.firstScan) {
      this.listAt = now;
      for (const account of this.accounts) await this.discover(account, now);
    }
    if (now - this.namesAt >= NAMES_REFRESH_MS || this.firstScan) {
      this.namesAt = now;
      for (const account of this.accounts) this.names.set(account.id, await readThreadNames(account.dir));
    }
    for (const item of [...this.tracked.values()]) await this.read(item, now);
    this.firstScan = false;
    this.deps.office.refresh(this.deps.now());
  }

  private refreshAccounts(now: number): void {
    if (this.accountsAt > 0 && now - this.accountsAt < ACCOUNT_REFRESH_MS && this.deps.settings.sessions) return;
    this.accountsAt = now;
    this.accounts = this.deps.settings.sessions ? codexAccounts(codexDirs(this.deps.discover)) : [];
    this.deps.office.setAccounts(this.accounts, 'codex');
  }

  private closeAll(): void {
    for (const key of [...this.tracked.keys()]) this.close(key, false);
  }

  // ---- discovery -------------------------------------------------------------------------------------------

  private async discover(account: Account, now: number): Promise<void> {
    const files = await listRollouts(account.dir, now - CODEX_OPEN_WINDOW_MS);
    const mains: { file: RolloutFile; head: RolloutHead }[] = [];
    const subs: { file: RolloutFile; head: RolloutHead }[] = [];
    let headReads = 0;
    for (const file of files) {
      if (headReads >= MAX_NEW_HEADS_PER_PASS) break;
      headReads++;
      const head = await readRolloutHead(file);
      if (head.kind === 'main') mains.push({ file, head });
      else if (head.kind === 'sub') subs.push({ file, head });
    }
    for (const { file, head } of mains) this.trackMain(account, file, head);
    for (const { file, head } of subs) this.trackSub(account, file, head);
    await this.closeStale(account, now);
  }

  private trackMain(account: Account, file: RolloutFile, head: RolloutHead): void {
    const key = sessionKey(account.id, head.threadId);
    const existing = this.tracked.get(key);
    if (existing !== undefined && existing.record.closedAt === undefined) {
      existing.file = file;
      return;
    }
    const record = this.deps.office.trackSession(account, head.threadId, undefined, false, !this.firstScan);
    this.tracked.set(key, {
      file,
      tailer: new JsonlTailer(file.path),
      translator: new RolloutTranslator(),
      primed: false,
      record,
      account,
      head,
      subs: new Map(),
      name: undefined,
    });
  }

  private trackSub(account: Account, file: RolloutFile, head: RolloutHead): void {
    if (head.parentId === undefined) return;
    const parent = this.tracked.get(sessionKey(account.id, head.parentId));
    if (parent === undefined || parent.subs.has(head.threadId) || parent.subs.size >= MAX_SUBS_PER_SESSION) return;
    parent.subs.set(head.threadId, {
      file,
      tailer: new JsonlTailer(file.path),
      translator: new RolloutTranslator(),
      primed: false,
    });
    this.deps.office.ensureSub(parent.record, head.threadId, {
      ...(head.role !== undefined ? { agentType: head.role } : {}),
      ...(head.nickname !== undefined ? { description: head.nickname } : {}),
    });
  }

  /** Sessions whose file went quiet (or vanished) have left. */
  private async closeStale(account: Account, now: number): Promise<void> {
    for (const [key, item] of [...this.tracked]) {
      if (item.account.id !== account.id) continue;
      const age = await ageOf(item.file.path, now);
      if (age === undefined || age > CODEX_OPEN_WINDOW_MS) this.close(key, true);
    }
  }

  private close(key: string, announce: boolean): void {
    this.deps.office.closeSession(key, announce);
    this.tracked.delete(key);
  }

  // ---- reading ---------------------------------------------------------------------------------------------

  private async read(item: TrackedSession, now: number): Promise<void> {
    await this.pull(item, item, undefined, now);
    this.applyName(item);
    for (const [threadId, sub] of item.subs) {
      const record = item.record.subs.get(threadId);
      if (record !== undefined) await this.pull(item, sub, record, now);
    }
  }

  private async pull(item: TrackedSession, followed: Followed, sub: SubRecord | undefined, now: number): Promise<void> {
    const result = await followed.tailer.read();
    if (result === undefined) return;
    if (result.reset) {
      resetTranscript(item.record, sub);
      followed.translator = new RolloutTranslator();
      followed.primed = false;
    }
    const parsed: ParsedLine[] = [];
    if (!followed.primed) {
      followed.primed = true;
      const first = await readFirstRecord(followed.file.path);
      if (first !== undefined) parsed.push(...followed.translator.translate(first));
    }
    for (const raw of result.lines) parsed.push(...followed.translator.translate(raw));
    if (parsed.length === 0) return;
    const replayBefore = result.initial || result.reset ? now - REPLAY_GRACE_MS : 0;
    this.deps.office.ingest(item.record, sub, parsed, replayBefore);
  }

  /** Codex's own name for the thread (session_index.jsonl) becomes the session title. */
  private applyName(item: TrackedSession): void {
    const name = this.names.get(item.account.id)?.get(item.head.threadId);
    if (name === undefined || name === item.name) return;
    item.name = name;
    this.deps.office.ingest(item.record, undefined, [{ kind: 'title', title: name }], 0);
  }
}

async function ageOf(path: string, now: number): Promise<number | undefined> {
  try {
    return now - (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
}
