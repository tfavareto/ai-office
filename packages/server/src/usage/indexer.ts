// The usage history index: keeps hourly rows of every transcript of every account up to date, in the background.
// It reads each file once (remembering the offset), re-reads only what was appended, never blocks the event loop for
// long, and saves itself to <stateDir>/usage-index. The cards and the detail view both read from it.
import {
  type Account,
  type AccountUsage,
  type HourMap,
  type UsageProgress,
  type UsageRow,
  addMonths,
  activeHoursInWeek,
  computeAccountUsage,
  computePeaks,
  startOfMonth,
} from '@ai-office/shared';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../log';
import { type TranscriptFile, discoverForAccount } from './discover';
import { type FileState, loadIndex, saveIndex } from './index-file';
import { RECENT_PERSISTED, type ScanContext, scanTranscript } from './scan-file';
import { UsageStore } from './usage-store';
import { type BurnSample, SAMPLE_KEEP_MS, burnOf, pruneSamples } from './burn';

const TICK_MS = 2000;
const WALK_MS = 10_000;
const HOT_MS = 15 * 60_000;
const FLUSH_MS = 15_000;
const PRUNE_MS = 6 * 3_600_000;
const RETENTION_MONTHS = 13;
const PEAKS_MS = 60_000;
const PERSIST_RECENT_MS = 3 * 3_600_000;

export interface IndexerDeps {
  stateDir: string;
  accounts: () => readonly Account[];
  log: Logger;
  now: () => number;
  tickMs?: number;
  walkMs?: number;
}

interface Job {
  initial: boolean;
  filesTotal: number;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
}

interface Candidate {
  file: TranscriptFile;
  state: FileState | undefined;
}

const fileKey = (account: string, rel: string): string => `${account}|${rel}`;
const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export class UsageIndexer {
  readonly store = new UsageStore();
  private files = new Map<string, FileState>();
  private readonly verified = new Set<string>();
  private readonly samples = new Map<string, BurnSample[]>();
  private readonly peaks = new Map<string, { at: number; value: AccountUsage['peaks'] }>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;
  private firstWalk = true;
  private lastWalkAt = 0;
  private lastFlushAt = 0;
  private lastPruneAt = 0;
  private generation = 0;
  private filesDirty = false;
  private job: Job | undefined;
  private ready = false;

  constructor(private readonly deps: IndexerDeps) {}

  /** Loads the saved index and starts the background loop. Returns without waiting for the first scan. */
  async start(): Promise<void> {
    await this.restore();
    this.timer = setInterval(() => this.tick(), this.deps.tickMs ?? TICK_MS);
    this.timer.unref();
    this.tick();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    while (this.running !== undefined) await this.running;
    await this.flush(this.deps.now());
  }

  private async restore(): Promise<void> {
    const loaded = await loadIndex(this.deps.stateDir);
    if (loaded === undefined) return;
    for (const row of loaded.rows) this.store.add(row);
    this.store.takeDirty();
    this.files = new Map(loaded.files.map((file) => [fileKey(file.account, file.rel), file]));
    this.generation = loaded.generation;
  }

  // ---- queries ------------------------------------------------------------------------------------------------

  progress(): UsageProgress {
    const job = this.job;
    if (!this.ready && job === undefined) return { state: 'indexing', percent: 0, filesDone: 0, filesTotal: 0 };
    if (job === undefined || !job.initial)
      return { state: 'ready', percent: 100, filesDone: job?.filesDone ?? 0, filesTotal: job?.filesTotal ?? 0 };
    const percent = job.bytesTotal <= 0 ? 100 : Math.min(99, Math.floor((job.bytesDone / job.bytesTotal) * 100));
    return { state: 'indexing', percent, filesDone: job.filesDone, filesTotal: job.filesTotal };
  }

  hoursOf(account: string): HourMap {
    return this.store.hoursOf(account);
  }

  rows(): IterableIterator<UsageRow> {
    return this.store.values();
  }

  /** The figures of the usage cards for these accounts. */
  compute(accountIds: readonly string[], now: number): AccountUsage[] {
    return accountIds.map((id) => {
      const hours = this.store.hoursOf(id);
      const burn = burnOf(this.samples.get(id) ?? [], now, activeHoursInWeek(hours, now));
      return computeAccountUsage(id, hours, now, { burn, peaks: this.peaksOf(id, hours, now) });
    });
  }

  private peaksOf(account: string, hours: HourMap, now: number): AccountUsage['peaks'] {
    const cached = this.peaks.get(account);
    if (cached !== undefined && now - cached.at < PEAKS_MS) return cached.value;
    const value = computePeaks(hours, now);
    this.peaks.set(account, { at: now, value });
    return value;
  }

  // ---- the loop -----------------------------------------------------------------------------------------------

  /** The timer's pass: skipped while the previous one is still running. */
  private tick(): void {
    if (this.running === undefined && !this.stopped) void this.refresh();
  }

  /** One pass: look for changed transcripts, read what is new, prune and save when due. Waits for a pass in progress. */
  async refresh(options: { walk?: boolean } = {}): Promise<void> {
    while (this.running !== undefined) await this.running;
    if (this.stopped) return;
    this.running = this.pass(options.walk === true).finally(() => {
      this.running = undefined;
    });
    await this.running;
  }

  private async pass(forceWalk: boolean): Promise<void> {
    try {
      await this.cycle(forceWalk);
    } catch (error) {
      this.deps.log.debug(`Falha ao indexar o uso: ${String(error)}`);
    }
  }

  private async cycle(forceWalk: boolean): Promise<void> {
    const now = this.deps.now();
    const accounts = this.deps.accounts();
    const walking = forceWalk || this.firstWalk || now - this.lastWalkAt >= (this.deps.walkMs ?? WALK_MS);
    const initial = this.firstWalk;
    const candidates = walking ? await this.walk(accounts, now) : await this.hotFiles(accounts, now);
    if (walking) {
      this.lastWalkAt = now;
      if (accounts.length > 0) this.firstWalk = false;
    }
    await this.process(candidates, initial && accounts.length > 0, now);
    if (!this.firstWalk || accounts.length === 0) this.ready = true;
    await this.maintain(now, initial);
  }

  private async walk(accounts: readonly Account[], now: number): Promise<Candidate[]> {
    const since = addMonths(startOfMonth(now), -1);
    const result: Candidate[] = [];
    for (const account of accounts) {
      const { files } = await discoverForAccount(account, since);
      for (const file of files) {
        const state = this.files.get(fileKey(file.account, file.rel));
        if (state === undefined ? file.mtimeMs >= since : file.size !== state.offset || file.ino !== state.ino)
          result.push({ file, state });
      }
    }
    return result;
  }

  /** Files that were written to in the last minutes: checked every tick, without listing the folders. */
  private async hotFiles(accounts: readonly Account[], now: number): Promise<Candidate[]> {
    const result: Candidate[] = [];
    for (const state of this.files.values()) {
      if (now - state.mtimeMs > HOT_MS) continue;
      const account = accounts.find((candidate) => candidate.id === state.account);
      if (account === undefined) continue;
      const path = join(account.dir, state.rel);
      try {
        const info = await stat(path);
        if (info.size !== state.offset || info.ino !== state.ino)
          result.push({
            file: {
              account: state.account,
              path,
              rel: state.rel,
              session: state.session,
              agent: state.agent,
              size: info.size,
              mtimeMs: info.mtimeMs,
              ino: info.ino,
              ...(account.source === 'codex' ? { source: 'codex' as const } : {}),
            },
            state,
          });
      } catch {
        // The transcript is gone; the saved state stays until it ages out.
      }
    }
    return result;
  }

  private async process(candidates: Candidate[], initial: boolean, now: number): Promise<void> {
    if (candidates.length === 0) {
      if (initial) this.job = undefined;
      return;
    }
    candidates.sort((a, b) => b.file.mtimeMs - a.file.mtimeMs);
    const job: Job = {
      initial,
      filesTotal: candidates.length,
      filesDone: 0,
      bytesTotal: candidates.reduce((sum, c) => sum + Math.max(0, c.file.size - (c.state?.offset ?? 0)), 0),
      bytesDone: 0,
    };
    this.job = job;
    const context = this.context(now);
    for (const { file, state } of candidates) {
      if (this.stopped) break;
      const key = fileKey(file.account, file.rel);
      const result = await scanTranscript(file, state, context, !this.verified.has(key));
      if (result.replaced) {
        await this.rebuild(now);
        return;
      }
      this.verified.add(key);
      this.files.set(key, result.state);
      this.filesDirty = true;
      job.filesDone++;
      job.bytesDone += result.bytes;
      await turn();
    }
    this.job = undefined;
  }

  private context(now: number): ScanContext {
    return {
      store: this.store,
      floor: addMonths(startOfMonth(now), -1),
      onChange: (account, at, tokens, costUSD) => {
        if (at < this.deps.now() - SAMPLE_KEEP_MS || (tokens === 0 && costUSD === 0)) return;
        const list = this.samples.get(account) ?? [];
        list.push({ at, tokens, costUSD });
        this.samples.set(account, list);
      },
      stopped: () => this.stopped,
      yieldTurn: turn,
    };
  }

  /** A transcript was replaced or truncated: what was counted from it cannot be told apart, so start over. */
  private async rebuild(now: number): Promise<void> {
    this.deps.log.debug('Transcrição substituída: reconstruindo o índice de uso');
    this.store.clear();
    this.files = new Map();
    this.verified.clear();
    this.samples.clear();
    this.peaks.clear();
    this.ready = false;
    this.job = undefined;
    this.filesDirty = true;
    await this.process(await this.walk(this.deps.accounts(), now), true, now);
    this.ready = true;
  }

  // ---- housekeeping and persistence ---------------------------------------------------------------------------

  private async maintain(now: number, initial: boolean): Promise<void> {
    if (now - this.lastPruneAt >= PRUNE_MS) {
      this.lastPruneAt = now;
      const cutoff = addMonths(startOfMonth(now), -RETENTION_MONTHS);
      this.store.prune(cutoff);
      for (const [key, state] of this.files) if (state.mtimeMs < cutoff) this.files.delete(key);
      this.filesDirty = true;
    }
    for (const [account, list] of this.samples) this.samples.set(account, pruneSamples(list, now));
    if (this.stopped) return;
    if (initial || now - this.lastFlushAt >= FLUSH_MS) await this.flush(now);
  }

  private async flush(now: number): Promise<void> {
    const months = this.store.takeDirty();
    if (months.length === 0 && !this.filesDirty) return;
    this.lastFlushAt = now;
    const counts = this.store.monthCounts();
    const written = new Map<string, readonly UsageRow[]>();
    const empty: string[] = [];
    for (const month of months) {
      if (counts.has(month)) written.set(month, this.store.rowsOfMonth(month));
      else empty.push(month);
    }
    try {
      await saveIndex(this.deps.stateDir, {
        generation: this.generation + 1,
        months: written,
        emptyMonths: empty,
        rowCounts: counts,
        files: [...this.files.values()].map((file) =>
          now - file.mtimeMs > PERSIST_RECENT_MS
            ? { ...file, recent: [] }
            : { ...file, recent: file.recent.slice(-RECENT_PERSISTED) },
        ),
      });
      this.generation++;
      this.filesDirty = false;
    } catch (error) {
      this.store.markDirty(months);
      this.deps.log.warn(`Não foi possível salvar o índice de uso: ${String(error)}`);
    }
  }
}
