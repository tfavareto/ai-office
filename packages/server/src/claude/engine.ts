// The ingest engine: discovers accounts and open sessions, tails transcripts and feeds the Office.
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Account } from '@ai-office/shared';
import type { Logger } from '../log';
import { type Office } from '../office/office';
import {
  NO_REGISTRY_SESSION_MS,
  type SessionRecord,
  type SubRecord,
  resetTranscript,
  sessionKey,
} from '../office/records';
import { type DiscoverOptions, discoverAccounts } from './accounts';
import { JsonlTailer } from './jsonl-tailer';
import { type SubagentFile, findTranscript, listMainTranscripts, listSubagents, subagentsDir } from './paths';
import { parseLine } from './line-parser';
import { type RegistryEntry, type PidCheck, isPidAlive, readRegistry } from './registry';
import type { ParsedLine } from './types';
import { Watchers } from './watchers';

export const POLL_INTERVAL_MS = 1000;
const ACCOUNT_REFRESH_MS = 10_000;
const NO_REGISTRY_SCAN_MS = 5000;
const RESOLVE_RETRY_MS = 2000;
/** Lines older than this at the first read of a file are history: they do not create feed items or notices. */
export const REPLAY_GRACE_MS = 15_000;
const SUB_MAX_AGE_MS = 30 * 60_000;

interface Tracked {
  record: SessionRecord;
  path: string | undefined;
  tailer: JsonlTailer | undefined;
  subTailers: Map<string, JsonlTailer>;
  lastResolveAt: number;
}

export interface EngineDeps {
  discover: DiscoverOptions;
  office: Office;
  log: Logger;
  now: () => number;
  pidAlive?: PidCheck;
}

export class Engine {
  private readonly tracked = new Map<string, Tracked>();
  private readonly watchers: Watchers;
  private accounts: Account[] = [];
  private accountsAt = 0;
  private noRegistryScanAt = 0;
  private timer: NodeJS.Timeout | undefined;
  private scanTimer: NodeJS.Timeout | undefined;
  private scanning = false;
  private rescan = false;
  private firstScan = true;
  private stopped = false;

  constructor(private readonly deps: EngineDeps) {
    this.watchers = new Watchers(() => this.requestScan());
  }

  async start(): Promise<void> {
    await this.scan();
    this.timer = setInterval(() => void this.scan(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.scanTimer !== undefined) clearTimeout(this.scanTimer);
    this.watchers.closeAll();
  }

  /** Debounced scan request (file system events). */
  requestScan(): void {
    if (this.scanTimer !== undefined || this.stopped) return;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = undefined;
      void this.scan();
    }, 120);
    this.scanTimer.unref();
  }

  /** One full pass. Overlapping calls are coalesced. */
  async scan(): Promise<void> {
    if (this.scanning) {
      this.rescan = true;
      return;
    }
    this.scanning = true;
    try {
      do {
        this.rescan = false;
        await this.scanOnce();
      } while (this.rescan && !this.stopped);
    } catch (error) {
      this.deps.log.debug(`Falha na leitura: ${String(error)}`);
    } finally {
      this.scanning = false;
    }
  }

  accountList(): Account[] {
    return this.accounts;
  }

  /** Counts of open sessions per account (for /api/health). */
  sessionCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const item of this.tracked.values()) {
      if (item.record.closedAt === undefined)
        counts.set(item.record.account.id, (counts.get(item.record.account.id) ?? 0) + 1);
    }
    return counts;
  }

  // ---- scanning -----------------------------------------------------------------------------------------------

  private async scanOnce(): Promise<void> {
    const now = this.deps.now();
    await this.refreshAccounts(now);
    for (const account of this.accounts) await this.syncAccount(account, now);
    for (const item of this.tracked.values()) await this.readSession(item, now);
    this.firstScan = false;
    this.deps.office.refresh(this.deps.now());
  }

  private async refreshAccounts(now: number): Promise<void> {
    if (this.accounts.length > 0 && now - this.accountsAt < ACCOUNT_REFRESH_MS) return;
    this.accountsAt = now;
    const found = await discoverAccounts(this.deps.discover);
    const changed =
      found.length !== this.accounts.length || found.some((account, i) => account.dir !== this.accounts[i]?.dir);
    this.accounts = found;
    this.deps.office.setAccounts(found);
    if (changed) this.deps.log.debug(`Contas: ${found.map((account) => account.dir).join(', ') || '(nenhuma)'}`);
  }

  private async syncAccount(account: Account, now: number): Promise<void> {
    const registry = await readRegistry(account.dir, this.deps.pidAlive ?? isPidAlive);
    if (registry.supported) {
      this.syncRegistryAccount(account, registry.open);
      return;
    }
    if (now - this.noRegistryScanAt < NO_REGISTRY_SCAN_MS && !this.firstScan) return;
    this.noRegistryScanAt = now;
    await this.syncByRecency(account, now);
  }

  private syncRegistryAccount(account: Account, open: RegistryEntry[]): void {
    const seen = new Set<string>();
    for (const entry of open) {
      const key = sessionKey(account.id, entry.sessionId);
      seen.add(key);
      const record = this.deps.office.trackSession(account, entry.sessionId, entry, true, !this.firstScan);
      this.ensureTracked(record);
    }
    for (const [key, item] of this.tracked) {
      if (item.record.account.id === account.id && item.record.registryMode && !seen.has(key)) this.close(key);
    }
  }

  private async syncByRecency(account: Account, now: number): Promise<void> {
    const recent = await listMainTranscripts(account.dir, now - NO_REGISTRY_SESSION_MS);
    const seen = new Set<string>();
    for (const file of recent) {
      const key = sessionKey(account.id, file.sessionId);
      seen.add(key);
      const record = this.deps.office.trackSession(account, file.sessionId, undefined, false, !this.firstScan);
      const item = this.ensureTracked(record);
      item.path ??= file.path;
    }
    for (const [key, item] of this.tracked) {
      if (item.record.account.id === account.id && !item.record.registryMode && !seen.has(key)) this.close(key);
    }
  }

  private ensureTracked(record: SessionRecord): Tracked {
    let item = this.tracked.get(record.key);
    if (item === undefined) {
      item = { record, path: undefined, tailer: undefined, subTailers: new Map(), lastResolveAt: 0 };
      this.tracked.set(record.key, item);
    }
    item.record = record;
    return item;
  }

  private close(key: string): void {
    const item = this.tracked.get(key);
    this.deps.office.closeSession(key, true);
    this.tracked.delete(key);
    if (item?.path !== undefined) {
      this.watchers.remove(item.path);
      this.watchers.remove(subagentsDir(item.path));
    }
  }

  // ---- reading ------------------------------------------------------------------------------------------------

  private async readSession(item: Tracked, now: number): Promise<void> {
    const { record } = item;
    if (item.tailer === undefined && !(await this.resolvePath(item, now))) return;
    const tailer = item.tailer as JsonlTailer;
    const result = await tailer.read();
    if (result !== undefined) this.feed(record, undefined, result.lines, result.reset, result.initial, now);
    await this.readSubagents(item, now);
    this.expireIfStale(item, now);
  }

  private async resolvePath(item: Tracked, now: number): Promise<boolean> {
    if (item.path === undefined) {
      if (now - item.lastResolveAt < RESOLVE_RETRY_MS) return false;
      item.lastResolveAt = now;
      item.path = await findTranscript(item.record.account.dir, item.record.sessionId, item.record.registry?.cwd);
    }
    if (item.path === undefined) return false;
    item.tailer = new JsonlTailer(item.path);
    this.watchers.add(item.path);
    this.watchers.add(dirname(item.path));
    return true;
  }

  private async readSubagents(item: Tracked, now: number): Promise<void> {
    if (item.path === undefined) return;
    const files = await listSubagents(item.path);
    if (files.length > 0) this.watchers.add(subagentsDir(item.path));
    for (const file of files) {
      const known = item.record.subs.has(file.agentId);
      if (!known && !(await this.isRecent(file, now))) continue;
      const sub = this.deps.office.ensureSub(item.record, file.agentId, file.meta);
      let tailer = item.subTailers.get(file.agentId);
      if (tailer === undefined) {
        tailer = new JsonlTailer(file.path);
        item.subTailers.set(file.agentId, tailer);
      }
      const result = await tailer.read();
      if (result !== undefined) this.feed(item.record, sub, result.lines, result.reset, result.initial, now);
    }
  }

  private async isRecent(file: SubagentFile, now: number): Promise<boolean> {
    try {
      return now - (await stat(file.path)).mtimeMs < SUB_MAX_AGE_MS;
    } catch {
      return false;
    }
  }

  private feed(
    record: SessionRecord,
    sub: SubRecord | undefined,
    raw: string[],
    reset: boolean,
    initial: boolean,
    now: number,
  ): void {
    if (reset) resetTranscript(record, sub);
    const parsed: ParsedLine[] = [];
    for (const text of raw) {
      const line = parseLine(text);
      if (line !== undefined) parsed.push(line);
      else if (text.trim().length > 0 && !text.trimStart().startsWith('{'))
        this.deps.log.debugOnce(`skip:${record.key}`, `Linha inválida ignorada em ${record.key}`);
    }
    if (parsed.length === 0) return;
    this.deps.office.ingest(record, sub, parsed, initial || reset ? now - REPLAY_GRACE_MS : 0);
  }

  /** Sessions without a registry leave after 30 min without events. */
  private expireIfStale(item: Tracked, now: number): void {
    const { record } = item;
    if (record.registryMode || record.closedAt !== undefined) return;
    const last = record.main.lastEventAt;
    if (last > 0 && now - last > NO_REGISTRY_SESSION_MS) this.close(record.key);
  }
}
