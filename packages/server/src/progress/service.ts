// The progress service: turns the finished local days into lifetime numbers, once each, and keeps today live.
//
// A day is read through `readDay` (the day report, which already joins the usage index), stored as compact facts and,
// once it is over, never read again. The first run reads up to `backfillDays` back; afterwards only the days since the
// last settled one. The numbers, the level and the unlocks come from the pure ledger in shared.
import {
  buildProgress,
  buildSummary,
  dayRange,
  localDateKey,
  addDays,
  settle,
  withDay,
  withEvent,
  withPeakAgents,
  withSettled,
  emptyState,
  type AchievementId,
  type DayFacts,
  type Progress,
  type ProgressEventName,
  type ProgressState,
  type ProgressSummary,
} from '@ai-office/shared';
import type { Logger } from '../log';
import type { ProgressStore } from './store';

export const BACKFILL_DAYS = 60;
export const REFRESH_MS = 5 * 60_000;
/** An endpoint call refreshes today when the last reading is older than this. */
export const STALE_MS = 60_000;
const PAUSE_BETWEEN_DAYS_MS = 1500;
const SAVE_DELAY_MS = 1500;
/** A day that stays incomplete (a scan cap, an index that never finishes) is accepted after this many tries. */
const MAX_INCOMPLETE_TRIES = 3;

/** What reading a day gave: its facts (none when nobody worked) and whether they can be trusted as final. */
export interface DayReading {
  facts?: DayFacts;
  /** False while the numbers may still grow (the scan hit a limit, or the usage index was still being built). */
  complete: boolean;
}

export interface ProgressDeps {
  now: () => number;
  log: Logger;
  store: Pick<ProgressStore, 'load' | 'save'>;
  readDay: (date: string) => Promise<DayReading>;
  /** Called when the summary changed (a new snapshot is due). */
  onChange: () => void;
  /** Called with the achievements earned by a change, for the log. */
  onUnlock?: (ids: readonly AchievementId[]) => void;
  backfillDays?: number;
  pauseMs?: number;
}

export class ProgressService {
  private current: ProgressState = emptyState();
  private running: Promise<void> | undefined;
  private lastRun = 0;
  private counting = false;
  private saveTimer: NodeJS.Timeout | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private wake: (() => void) | undefined;
  private readonly tries = new Map<string, number>();
  private cached: { month: string; summary: ProgressSummary } | undefined;

  constructor(private readonly deps: ProgressDeps) {}

  get state(): ProgressState {
    return this.current;
  }

  /** Loads the stored progress and starts reading the history in the background. */
  async start(): Promise<void> {
    this.current = await this.deps.store.load();
    this.cached = undefined;
    this.deps.onChange();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.refreshTimer.unref();
    void this.refresh();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wake?.();
    if (this.refreshTimer !== undefined) clearInterval(this.refreshTimer);
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    await this.running?.catch(() => undefined);
    await this.deps.store.save(this.current);
  }

  /** Reads what is missing; calls while a run is going share it. */
  refresh(): Promise<void> {
    if (this.running === undefined) {
      this.running = this.run()
        .catch((error: unknown) => this.deps.log.warn(`Progresso: ${String(error)}`))
        .finally(() => {
          this.running = undefined;
          this.lastRun = this.deps.now();
        });
    }
    return this.running;
  }

  /** The endpoint asks for fresh numbers without waiting for them. */
  refreshIfStale(): void {
    if (this.running === undefined && this.deps.now() - this.lastRun >= STALE_MS) void this.refresh();
  }

  async recordEvent(event: ProgressEventName): Promise<void> {
    if (this.current.events[event] !== undefined) return;
    this.apply(withEvent(this.current, event, this.deps.now()));
  }

  /** The most agents seen in the office at once (the day reports only know who worked in the same half hour). */
  observeAgents(count: number): void {
    if (count > this.current.records.peakAgents) this.apply(withPeakAgents(this.current, count));
  }

  progress(includeProject: boolean): Progress {
    return buildProgress(this.current, { now: this.deps.now(), includeProject, counting: this.counting });
  }

  /** What the snapshot carries; rebuilt only when the progress changed or the month turned. */
  summary(): ProgressSummary {
    const month = localDateKey(this.deps.now()).slice(0, 7);
    if (this.cached?.month !== month) this.cached = { month, summary: buildSummary(this.current, this.deps.now()) };
    return this.cached.summary;
  }

  // ---------------------------------------------------------------------------------------------------------------

  private async run(): Promise<void> {
    const todayKey = localDateKey(this.deps.now());
    const today = dayRange(todayKey);
    if (today === undefined) return;
    const first = this.firstDayToRead(today.start);
    this.counting = this.current.settledThrough === undefined;
    let day = first;
    while (!this.stopped && day < today.start) {
      const key = localDateKey(day);
      const read = await this.readAndStore(key, true);
      if (read === undefined) break;
      day = addDays(day, 1);
      // Days with work are the expensive ones: breathe between them so the page and the hooks stay snappy.
      if (read && day < today.start) await this.pause(this.deps.pauseMs ?? PAUSE_BETWEEN_DAYS_MS);
    }
    if (!this.stopped) await this.readAndStore(todayKey, false);
    this.counting = false;
    this.deps.onChange();
    await this.saveNow();
  }

  private firstDayToRead(todayStart: number): number {
    const settled = this.current.settledThrough;
    const next = settled === undefined ? undefined : dayRange(settled);
    const backfill = addDays(todayStart, -(this.deps.backfillDays ?? BACKFILL_DAYS));
    return next === undefined ? backfill : Math.max(backfill, addDays(next.start, 1));
  }

  /** A pause that ends early when the service stops. */
  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      this.wake = done;
      function done(): void {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  /**
   * Reads one day and stores it; `final` days that came out complete are marked settled. Resolves whether the day had
   * work, or undefined to stop the run (a day that cannot be read yet).
   */
  private async readAndStore(date: string, final: boolean): Promise<boolean | undefined> {
    let reading: DayReading;
    try {
      reading = await this.deps.readDay(date);
    } catch (error) {
      this.deps.log.debug(`Progresso: não foi possível ler ${date}: ${String(error)}`);
      return undefined;
    }
    let next = reading.facts === undefined ? this.current : withDay(this.current, reading.facts, this.deps.now());
    if (final) {
      const tries = (this.tries.get(date) ?? 0) + 1;
      this.tries.set(date, tries);
      if (!reading.complete && tries < MAX_INCOMPLETE_TRIES) {
        this.apply(next);
        return undefined;
      }
      this.tries.delete(date);
      next = withSettled(next, date);
    }
    this.apply(next);
    return reading.facts !== undefined;
  }

  private apply(state: ProgressState): void {
    const { state: settled, unlocked } = settle(state, this.deps.now());
    this.current = settled;
    this.cached = undefined;
    if (unlocked.length > 0) this.deps.onUnlock?.(unlocked);
    this.deps.onChange();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== undefined || this.stopped) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.deps.store.save(this.current);
    }, SAVE_DELAY_MS);
    this.saveTimer.unref();
  }

  private async saveNow(): Promise<void> {
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    await this.deps.store.save(this.current);
  }
}
