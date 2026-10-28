// Fetches the conversation of one canvas terminal while it is live: the newest page first, then only what follows
// (`after` = the cursor of the last page) every `pollMs`, and right away when the office sees the agent do something
// (`nudge`). It never has more than one request in flight, keeps its timer when it is told the same thing again,
// sleeps while the page is hidden, backs off after a failure, and keeps what it has so a terminal that goes out of
// view and comes back continues from where it stopped.
import type { TranscriptPage } from '@ai-office/shared';
import { applyPage, EMPTY_LIVE, type LiveTranscript } from '../model/live-transcript';

export type FeedStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface FeedSource {
  /** `after` undefined asks for the newest entries. */
  page(after: number | undefined): Promise<TranscriptPage>;
}

/** After a failure the feed waits at least this long before asking again. */
export const RETRY_MS = 5000;
/** A nudge right after a fetch waits for the next poll instead (several snapshots can arrive in a burst). */
export const NUDGE_GAP_MS = 250;

/** What the feed needs from the page: the clock, and whether the page is hidden (with a way to hear it come back). */
export interface FeedHost {
  now(): number;
  hidden(): boolean;
  onVisible(callback: () => void): () => void;
}

const DOCUMENT_HOST: FeedHost = {
  now: () => Date.now(),
  hidden: () => typeof document !== 'undefined' && document.hidden,
  onVisible: (callback) => {
    if (typeof document === 'undefined') return () => undefined;
    const listener = (): void => {
      if (!document.hidden) callback();
    };
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

export class TranscriptFeed {
  state: LiveTranscript = EMPTY_LIVE;
  status: FeedStatus = 'idle';
  error: unknown = null;
  private pollMs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private token = 0;
  private lastFetchAt = Number.NEGATIVE_INFINITY;
  private lastErrorAt = Number.NEGATIVE_INFINITY;
  private stopWaiting: (() => void) | null = null;

  constructor(
    private readonly source: FeedSource,
    private readonly onChange: () => void,
    private readonly host: FeedHost = DOCUMENT_HOST,
  ) {}

  /** Polling (a live terminal): the timer or the request that keeps it fresh is running. */
  get running(): boolean {
    return this.inFlight || this.timer !== null || this.stopWaiting !== null;
  }

  /**
   * Starts or retunes the feed: loads the first page when it has none, then polls every `pollMs` (0 = load once, no
   * polling). Called again with the same interval it changes nothing, so a timer is never pushed back.
   */
  run(pollMs: number): void {
    const changed = pollMs !== this.pollMs;
    this.pollMs = pollMs;
    if (this.inFlight) return;
    if (this.status === 'idle') {
      void this.fetch(undefined);
      return;
    }
    if (this.status === 'error') {
      if (this.timer === null) this.scheduleRetry();
      return;
    }
    if (changed || !this.running) this.schedule();
  }

  /** The office saw the agent do something: fetch what follows now instead of at the next poll. */
  nudge(): void {
    if (this.status !== 'ready' || this.pollMs <= 0 || this.inFlight || this.host.hidden()) return;
    if (this.host.now() - this.lastFetchAt < NUDGE_GAP_MS) return;
    this.clearTimer();
    void this.fetch(this.state.next);
  }

  stop(): void {
    this.token++;
    this.pollMs = 0;
    this.inFlight = false;
    this.clearTimer();
    // A first load that was cut off starts again from the newest page next time.
    if (this.status === 'loading') this.status = 'idle';
  }

  /** The Retry button: ask again now, whatever the backoff. */
  retry(): void {
    this.clearTimer();
    this.status = this.state.loaded ? 'ready' : 'idle';
    this.lastErrorAt = Number.NEGATIVE_INFINITY;
    const pollMs = this.pollMs > 0 ? this.pollMs : 1000;
    this.pollMs = -1;
    this.run(pollMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.stopWaiting?.();
    this.stopWaiting = null;
  }

  private async fetch(after: number | undefined): Promise<void> {
    const token = ++this.token;
    this.inFlight = true;
    this.lastFetchAt = this.host.now();
    if (this.status === 'idle') this.status = 'loading';
    let failed = false;
    try {
      const page = await this.source.page(after);
      if (token !== this.token) return;
      this.state = applyPage(this.state, page, after);
      this.status = 'ready';
      this.error = null;
    } catch (error) {
      if (token !== this.token) return;
      failed = true;
      this.error = error;
      this.lastErrorAt = this.host.now();
      if (this.status !== 'ready') this.status = 'error';
    }
    this.inFlight = false;
    this.onChange();
    if (this.status === 'error') this.scheduleRetry();
    else this.schedule(failed);
  }

  /** A first load that failed tries again once the backoff has passed (if it is still wanted). */
  private scheduleRetry(): void {
    if (this.pollMs <= 0) return;
    const wait = Math.max(0, this.lastErrorAt + RETRY_MS - this.host.now());
    this.later(wait, () => {
      this.status = 'idle';
      void this.fetch(undefined);
    });
  }

  private schedule(failed = false): void {
    this.clearTimer();
    if (this.pollMs <= 0 || (!this.state.open && !failed)) return;
    this.later(failed ? Math.max(RETRY_MS, this.pollMs) : this.pollMs, () => void this.fetch(this.state.next));
  }

  /** Runs `action` after `ms`, or when the page shows again if it is hidden by then. */
  private later(ms: number, action: () => void): void {
    this.clearTimer();
    const token = this.token;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (token !== this.token) return;
      if (!this.host.hidden()) {
        action();
        return;
      }
      this.stopWaiting = this.host.onVisible(() => {
        this.stopWaiting?.();
        this.stopWaiting = null;
        if (token === this.token) action();
      });
    }, ms);
  }
}
