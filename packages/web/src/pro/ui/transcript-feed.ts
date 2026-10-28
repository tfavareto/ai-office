// Fetches the conversation of one canvas terminal while it is live: the newest page first, then the new entries every
// `pollMs`. It never has more than one request in flight, stops when told to, and keeps what it has so a terminal that
// goes out of view and comes back continues from where it stopped.
import type { TranscriptPage } from '@ai-office/shared';
import { applyPage, EMPTY_LIVE, type LiveTranscript } from '../model/live-transcript';

export type FeedStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface FeedSource {
  /** `after` undefined asks for the newest entries. */
  page(after: number | undefined): Promise<TranscriptPage>;
}

/** After a failure the feed waits at least this long before asking again. */
const RETRY_MS = 5000;

export class TranscriptFeed {
  state: LiveTranscript = EMPTY_LIVE;
  status: FeedStatus = 'idle';
  error: unknown = null;
  private pollMs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private token = 0;

  constructor(
    private source: FeedSource,
    private readonly onChange: () => void,
  ) {}

  /** The session this feed reads changed (a new source): start over. */
  reset(source: FeedSource): void {
    this.stop();
    this.source = source;
    this.state = EMPTY_LIVE;
    this.status = 'idle';
    this.error = null;
  }

  /** Starts (or retunes) the feed: loads the first page if needed, then polls every `pollMs` (0 = once, no polling). */
  run(pollMs: number): void {
    this.pollMs = pollMs;
    if (this.inFlight) return;
    if (this.status === 'idle' || this.status === 'error') {
      void this.fetch(undefined);
      return;
    }
    this.schedule();
  }

  stop(): void {
    this.token++;
    this.pollMs = 0;
    this.inFlight = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  retry(): void {
    this.status = 'idle';
    this.run(this.pollMs > 0 ? this.pollMs : 1000);
  }

  private async fetch(after: number | undefined): Promise<void> {
    const token = ++this.token;
    this.inFlight = true;
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
      if (this.status !== 'ready') this.status = 'error';
    }
    this.inFlight = false;
    this.onChange();
    this.schedule(failed);
  }

  private schedule(failed = false): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.pollMs <= 0 || (this.status === 'ready' && !this.state.open && !failed)) return;
    if (this.status === 'error') return;
    const token = this.token;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (token !== this.token) return;
        if (typeof document !== 'undefined' && document.hidden) this.schedule();
        else void this.fetch(this.state.next);
      },
      failed ? Math.max(RETRY_MS, this.pollMs) : this.pollMs,
    );
  }
}
