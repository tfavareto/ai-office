// The time-lapse mode of the page: loads the day, owns the playback clock, and each frame turns the clock into a
// snapshot for the world. The panels read `snapshot`, `feed` and `clock` from here instead of the live store while it is
// on. No DOM: the frame loop, the backend and the world are injected, so the whole thing runs under test.
import type { Account, FeedItem, OfficeMeta, OfficeSnapshot, Timelapse } from '@ai-office/shared';
import { describeError } from '../net/backend';
import type { Backend } from '../net/backend';
import { DEFAULT_SPEED, type ClockState, type Speed, advance, atEnd, seek as seekClock, setSpeed as setClockSpeed, skip as skipClock, startClock, togglePlay } from '../timelapse/clock';
import { type Marker, buildMarkers } from '../timelapse/markers';
import { type ReplayIndex, buildReplay, feedAt, snapshotAt } from '../timelapse/replay';
import { Observable } from './observable';

/** The world gets a new snapshot at most this often while playing (it is drawn every frame regardless). */
export const PRESENT_EVERY_MS = 50;
/** The panels are rebuilt at most this often while playing. */
export const RENDER_EVERY_MS = 250;
const FEED_LIMIT = 100;
/** Marks closer than this fraction of the span merge into one. */
const MARKER_MERGE_FRACTION = 1 / 100;

export type ReplayPhase = 'off' | 'loading' | 'error' | 'ready';

/** What the panels need to know; replaced (never mutated) when it changes. */
export interface ReplayView {
  phase: ReplayPhase;
  /** The day shown or being loaded, YYYY-MM-DD. */
  date: string;
  error?: string;
  /** The day had nothing to replay. */
  empty: boolean;
  playing: boolean;
  speed: Speed;
  /** A scan limit was hit, the day was thinned, or it is made-up demo content. */
  notes: { truncated: boolean; trimmed: boolean; demo: boolean };
}

export interface ReplayDeps {
  backend: () => Backend;
  /** The account to show: an id or "all". */
  account: () => string;
  /** The accounts and meta of the live office, which the snapshots borrow. */
  base: () => { accounts: readonly Account[]; meta: OfficeMeta | undefined };
  /** Puts a snapshot on the world; `jump` when the people and rooms must be placed at once. */
  present: (snapshot: OfficeSnapshot, at: number, jump: boolean) => void;
  /** Something the panels show changed. */
  render: () => void;
  frame: (callback: (stamp: number) => void) => number;
  cancelFrame: (handle: number) => void;
}

const OFF: ReplayView = { phase: 'off', date: '', empty: false, playing: false, speed: DEFAULT_SPEED, notes: { truncated: false, trimmed: false, demo: false } };
const FALLBACK_META: OfficeMeta = { version: '', startedAt: 0, local: false, demo: false };

export class ReplayController extends Observable<ReplayView> {
  private index: ReplayIndex | undefined;
  private current: OfficeSnapshot | null = null;
  private feedCache: { at: number; items: FeedItem[] } | undefined;
  private markerList: readonly Marker[] = [];
  private clockState: ClockState | undefined;
  private token = 0;
  private handle = 0;
  private lastStamp: number | undefined;
  private lastPresent = Number.NEGATIVE_INFINITY;
  private lastRender = Number.NEGATIVE_INFINITY;
  private rev = 0;
  private readonly frameListeners = new Set<(clock: ClockState) => void>();

  constructor(private readonly deps: ReplayDeps) {
    super(OFF);
  }

  /** The mode is on: the day is loading, failed, or playing. */
  get engaged(): boolean {
    return this.value.phase !== 'off';
  }

  /** The panels show the replay (the day is loaded). */
  get active(): boolean {
    return this.value.phase === 'ready';
  }

  /** Where the replay is; moves every frame while playing without notifying the subscribers of the view. */
  get clock(): ClockState | undefined {
    return this.clockState;
  }

  /** The office as it was at the replay's time; null until the day is loaded. */
  get snapshot(): OfficeSnapshot | null {
    return this.current;
  }

  get markers(): readonly Marker[] {
    return this.markerList;
  }

  get timelapse(): Timelapse | undefined {
    return this.index?.timelapse;
  }

  /** The latest activities up to the replay's time, oldest first. */
  feed(): readonly FeedItem[] {
    const clock = this.clockState;
    if (this.index === undefined || clock === undefined) return [];
    if (this.feedCache?.at !== clock.t) this.feedCache = { at: clock.t, items: feedAt(this.index, clock.t, FEED_LIMIT) };
    return this.feedCache.items;
  }

  /** Called with the clock on every frame it moves (to keep a time readout and a scrubber current). */
  onFrame(listener: (clock: ClockState) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  // ---- commands ---------------------------------------------------------------------------------------------------

  /** Loads a day and plays it from the start of its active span. */
  async start(date: string): Promise<void> {
    const token = ++this.token;
    this.halt();
    // The day on screen stays (frozen) until the new one arrives.
    this.replace({ ...OFF, phase: 'loading', date });
    this.deps.render();
    try {
      const timelapse = await this.deps.backend().timelapse({ date, account: this.deps.account() });
      if (token !== this.token) return;
      this.open(timelapse);
    } catch (error) {
      if (token !== this.token) return;
      this.replace({ ...OFF, phase: 'error', date, error: describeError(error) });
      this.deps.render();
    }
  }

  /** Leaves the mode; the caller puts the live office back on the world. */
  stop(): void {
    this.token++;
    this.halt();
    this.clockState = undefined;
    this.index = undefined;
    this.current = null;
    this.feedCache = undefined;
    this.markerList = [];
    this.replace(OFF);
    this.deps.render();
  }

  togglePlay(): void {
    const clock = this.running();
    if (clock === undefined) return;
    this.apply(togglePlay(clock), false);
  }

  seek(at: number): void {
    const clock = this.running();
    if (clock !== undefined) this.apply(seekClock(clock, at), true);
  }

  skip(deltaMs: number): void {
    const clock = this.running();
    if (clock !== undefined) this.apply(skipClock(clock, deltaMs), true);
  }

  setSpeed(speed: Speed): void {
    const clock = this.running();
    if (clock !== undefined) this.apply(setClockSpeed(clock, speed), false);
  }

  /** The clock, while the day is loaded and the commands make sense. */
  private running(): ClockState | undefined {
    return this.value.phase === 'ready' ? this.clockState : undefined;
  }

  // ---- internals --------------------------------------------------------------------------------------------------

  private open(timelapse: Timelapse): void {
    this.index = buildReplay(timelapse);
    this.feedCache = undefined;
    const notes = { truncated: timelapse.truncated === true, trimmed: timelapse.trimmed === true, demo: timelapse.demo === true };
    if (timelapse.from === undefined || timelapse.to === undefined || timelapse.agents.length === 0) {
      this.markerList = [];
      this.current = this.snapshotFor(timelapse.start);
      this.replace({ ...OFF, phase: 'ready', date: timelapse.date, empty: true, notes });
      this.deps.present(this.current, timelapse.start, true);
      this.deps.render();
      return;
    }
    this.markerList = buildMarkers(timelapse, (timelapse.to - timelapse.from) * MARKER_MERGE_FRACTION);
    const clock = startClock(timelapse.from, timelapse.to);
    this.clockState = clock;
    this.replace({ ...OFF, phase: 'ready', date: timelapse.date, playing: true, speed: clock.speed, notes });
    this.show(clock.t, true);
    this.deps.render();
    this.schedule();
  }

  /** Takes a new clock: presents the world, tells the panels, and runs or stops the frame loop. */
  private apply(clock: ClockState, jump: boolean): void {
    this.clockState = clock;
    this.syncView(clock);
    this.show(clock.t, jump);
    for (const listener of this.frameListeners) listener(clock);
    this.deps.render();
    if (clock.playing) this.schedule();
    else this.halt();
  }

  /** The view carries only what changes rarely: whether it plays and how fast. */
  private syncView(clock: ClockState): void {
    if (this.value.playing !== clock.playing || this.value.speed !== clock.speed) this.replace({ ...this.value, playing: clock.playing, speed: clock.speed });
  }

  private snapshotFor(at: number): OfficeSnapshot {
    const base = this.deps.base();
    return snapshotAt(this.index as ReplayIndex, at, { accounts: base.accounts, meta: { ...(base.meta ?? FALLBACK_META), demo: this.index?.timelapse.demo === true, local: false }, rev: ++this.rev });
  }

  private show(at: number, jump: boolean): void {
    if (this.index === undefined) return;
    this.current = this.snapshotFor(at);
    this.deps.present(this.current, at, jump);
  }

  private schedule(): void {
    if (this.handle !== 0) return;
    this.handle = this.deps.frame((stamp) => this.tick(stamp));
  }

  private halt(): void {
    if (this.handle !== 0) this.deps.cancelFrame(this.handle);
    this.handle = 0;
    this.lastStamp = undefined;
  }

  private tick(stamp: number): void {
    this.handle = 0;
    const clock = this.clockState;
    if (this.value.phase !== 'ready' || clock === undefined || !clock.playing) return;
    const elapsed = this.lastStamp === undefined ? 0 : stamp - this.lastStamp;
    this.lastStamp = stamp;
    const next = advance(clock, elapsed);
    const finished = !next.playing && atEnd(next);
    this.clockState = next;
    this.syncView(next);
    if (stamp - this.lastPresent >= PRESENT_EVERY_MS || finished) {
      this.lastPresent = stamp;
      this.show(next.t, false);
    }
    for (const listener of this.frameListeners) listener(next);
    if (stamp - this.lastRender >= RENDER_EVERY_MS || finished) {
      this.lastRender = stamp;
      this.deps.render();
    }
    if (next.playing) this.schedule();
    else this.lastStamp = undefined;
  }
}
