// The time-lapse controls: play and pause, the time of the replay, a scrubber with marks for the moments worth
// jumping to, the speeds, the day picker and the way back to the live office. Floats above the feed.
import { reportDates } from '@ai-office/shared';
import { t } from '../../i18n';
import { BIG_SKIP_MS, SKIP_MS, SPEEDS, isSpeed, type ClockState, type Speed } from '../../timelapse/clock';
import { markerNear, type Marker } from '../../timelapse/markers';
import type { AppContext, Component } from '../context';
import { h, setAttr, setText, toggleClass } from '../dom';
import { formatClock, formatDateKey, formatDateLong, formatDuration } from '../format';
import { icon } from '../icons';
import {
  MARKER_REACH_PX,
  axisTicks,
  fractionAt,
  liveAttention,
  markerStep,
  percentOf,
  pixelsToMs,
} from '../model/replay';
import { createSegmented, iconButton } from '../widgets';
import { pickerLabel } from './report-parts';

const MARKER_CLASS: Readonly<Record<Marker['kind'], string>> = {
  commit: 'commit',
  'test-failed': 'failed',
  wait: 'wait',
  arrival: 'arrival',
};

/** The words that describe a mark (what happened, who, where). */
export function describeMarker(marker: Marker): string {
  const who = marker.agent ?? '';
  const detail = marker.detail ?? '';
  switch (marker.kind) {
    case 'commit':
      return marker.agent === undefined
        ? t('replay.marker.commitAnon', { project: marker.project, subject: detail })
        : t('replay.marker.commit', { agent: who, project: marker.project, subject: detail });
    case 'test-failed':
      return t('replay.marker.testFailed', { runner: detail, agent: who, project: marker.project });
    case 'wait':
      return t('replay.marker.wait', {
        agent: who,
        duration: formatDuration(marker.durationMs ?? 0),
        tool: detail,
        project: marker.project,
      });
    case 'arrival':
      return t('replay.marker.arrival', { agent: who, project: marker.project });
  }
}

export class ReplayBar implements Component {
  readonly el = h('section', { class: 'ao-replay', 'aria-label': t('replay.bar'), hidden: true });
  private readonly playBtn: HTMLButtonElement;
  private readonly time = h('span', { class: 'ao-replay-time' });
  private readonly date = h('span', { class: 'ao-replay-date' });
  private readonly range = h('input', {
    type: 'range',
    class: 'ao-replay-range',
    min: '0',
    max: '1',
    step: '1',
    'aria-label': t('replay.scrubber'),
  });
  private readonly markers = h('div', { class: 'ao-replay-markers' });
  private readonly axis = h('div', { class: 'ao-replay-axis', 'aria-hidden': 'true' });
  private readonly tip = h('div', { class: 'ao-replay-tip', role: 'presentation', hidden: true });
  private readonly track = h('div', { class: 'ao-replay-track' });
  private readonly speeds = createSegmented<`${Speed}`>(
    t('replay.speed'),
    SPEEDS.map((speed) => ({ value: `${speed}` as const, label: `${speed}×` })),
    (value) => this.setSpeed(Number(value)),
  );
  private readonly days = h('select', { class: 'ao-replay-days', 'aria-label': t('replay.day') });
  private readonly liveBtn: HTMLButtonElement;
  private readonly status = h('p', { class: 'ao-replay-status', role: 'status' });
  private readonly notes = h('div', { class: 'ao-replay-notes' });
  private readonly attention: HTMLButtonElement;
  private readonly unsubscribe: () => void;
  private daySignature = '';
  private noteSignature = '';
  private spanSignature = '';
  private lastFrame: ClockState | undefined;
  private shownPlaying: boolean | undefined;

  constructor(private readonly ctx: AppContext) {
    this.attention = h('button', {
      type: 'button',
      class: 'ao-replay-attention',
      hidden: true,
      title: t('replay.attention.hint'),
      onclick: () => ctx.stopReplay(),
    });
    this.playBtn = iconButton({
      icon: 'play',
      label: t('replay.play'),
      className: 'ao-replay-play',
      size: 20,
      onClick: () => ctx.replay.togglePlay(),
    });
    this.liveBtn = h(
      'button',
      {
        type: 'button',
        class: 'ao-btn ao-btn--soft ao-replay-live',
        title: t('replay.live.hint'),
        onclick: () => ctx.stopReplay(),
      },
      icon('x', 16),
      h('span', null, t('replay.live')),
      h('kbd', { class: 'ao-kbd' }, 'Esc'),
    );
    this.range.addEventListener('input', () => ctx.replay.seek(Number(this.range.value)));
    this.range.addEventListener('keydown', (event) => this.onRangeKey(event));
    this.range.addEventListener('pointermove', (event) => this.showTip(event));
    this.range.addEventListener('pointerleave', () => this.hideTip());
    this.range.addEventListener('blur', () => this.hideTip());
    this.days.addEventListener('change', () => ctx.startReplay(this.days.value));
    this.track.append(this.markers, this.range, this.axis, this.tip);
    const clock = h('div', { class: 'ao-replay-clock', 'aria-hidden': 'true' }, this.time, this.date);
    this.el.append(
      this.notes,
      h(
        'div',
        { class: 'ao-replay-main' },
        this.playBtn,
        clock,
        h('span', { class: 'ao-replay-spacer' }),
        this.speeds.el,
        h('label', { class: 'ao-replay-dayrow' }, icon('calendar', 16), this.days),
        this.liveBtn,
      ),
      this.track,
      this.status,
    );
    this.speeds.el
      .querySelectorAll('button')
      .forEach((option, position) =>
        option.setAttribute('title', t('replay.speed.option', { n: SPEEDS[position] ?? 0 })),
      );
    this.unsubscribe = ctx.replay.onFrame((clockState) => this.paint(clockState));
  }

  dispose(): void {
    this.unsubscribe();
  }

  render(): void {
    const view = this.ctx.replay.get();
    const engaged = this.ctx.replay.engaged;
    this.el.hidden = !engaged;
    if (!engaged) return;
    const clock = this.ctx.replay.clock;
    const ready = view.phase === 'ready' && clock !== undefined;
    toggleClass(this.el, 'is-loading', view.phase === 'loading');
    toggleClass(this.el, 'is-empty', view.phase !== 'loading' && !ready);
    this.renderStatus(view.phase, view.error, view.empty);
    this.renderPlay(view.playing, clock);
    this.speeds.set(`${view.speed}`);
    this.renderDays(view.date);
    this.renderNotes(view.notes);
    if (clock !== undefined) {
      this.renderSpan(clock);
      this.paint(clock);
    }
    for (const control of [this.playBtn, this.range]) control.disabled = !ready;
    this.renderAttention();
  }

  // ---- parts ------------------------------------------------------------------------------------------------------

  private renderStatus(phase: string, error: string | undefined, empty: boolean): void {
    const text =
      phase === 'loading'
        ? t('replay.loading')
        : phase === 'error'
          ? `${t('replay.error')} ${error ?? ''}`.trim()
          : empty
            ? t('replay.empty')
            : '';
    setText(this.status, text);
    this.status.hidden = text === '';
    toggleClass(this.status, 'is-error', phase === 'error');
  }

  private renderPlay(playing: boolean, clock: ClockState | undefined): void {
    const ended = clock !== undefined && clock.t >= clock.to;
    const label = playing ? t('replay.pause') : ended ? t('replay.again') : t('replay.play');
    if (this.shownPlaying !== playing) {
      this.shownPlaying = playing;
      this.playBtn.replaceChildren(icon(playing ? 'pause' : 'play', 20));
    }
    setAttr(this.playBtn, 'aria-label', label);
    setAttr(this.playBtn, 'title', label);
    setAttr(this.playBtn, 'aria-pressed', String(playing));
  }

  private renderDays(date: string): void {
    const dates = reportDates(this.ctx.store.now());
    const signature = `${dates.join(',')}|${date}|${t('time.today')}`;
    if (signature === this.daySignature) return;
    this.daySignature = signature;
    this.days.replaceChildren(
      ...dates.map((value, index) => {
        const option = h('option', { value }, `${pickerLabel(value, index)} · ${formatDateKey(value)}`);
        option.selected = value === date;
        return option;
      }),
    );
  }

  private renderNotes(notes: { truncated: boolean; trimmed: boolean; demo: boolean }): void {
    const lines = [
      notes.demo ? t('replay.note.demo') : '',
      notes.truncated ? t('replay.note.truncated') : '',
      notes.trimmed ? t('replay.note.trimmed') : '',
    ].filter((line) => line !== '');
    const signature = lines.join('|');
    if (signature === this.noteSignature) return;
    this.noteSignature = signature;
    this.notes.replaceChildren(...lines.map((line) => h('span', { class: 'ao-replay-note' }, line)), this.attention);
    this.syncNotes();
  }

  private syncNotes(): void {
    this.notes.hidden = this.noteSignature === '' && this.attention.hidden;
  }

  private renderAttention(): void {
    const waiting = liveAttention(this.ctx.liveSnapshot);
    this.attention.hidden = waiting === 0;
    if (waiting > 0)
      this.attention.replaceChildren(icon('alert', 14), h('span', null, t('replay.attention', { n: waiting })));
    this.syncNotes();
  }

  /** Redraws what depends on the span: the marks and the labels under the scrubber. */
  private renderSpan(clock: ClockState): void {
    const markers = this.ctx.replay.markers;
    const signature = `${clock.from}|${clock.to}|${markers.length}`;
    if (signature === this.spanSignature) return;
    this.spanSignature = signature;
    this.range.min = String(clock.from);
    this.range.max = String(clock.to);
    this.axis.replaceChildren(
      ...axisTicks(clock.from, clock.to).map((at) =>
        h('span', { style: `left:${percentOf(at, clock.from, clock.to)}%` }, formatClock(at)),
      ),
    );
    this.markers.replaceChildren(
      ...markers.map((marker) => {
        const label = describeMarker(marker);
        return h('button', {
          type: 'button',
          class: `ao-replay-mark ao-replay-mark--${MARKER_CLASS[marker.kind]}`,
          style: `left:${percentOf(marker.at, clock.from, clock.to)}%`,
          tabindex: '-1',
          'aria-label': t('replay.marker.go', { time: formatClock(marker.at) }),
          'data-at': String(marker.at),
          title: label,
          onclick: () => this.ctx.replay.seek(marker.at),
        });
      }),
    );
  }

  /** Per frame: the time readout, the scrubber thumb and its fill. */
  private paint(clock: ClockState): void {
    if (!this.ctx.replay.engaged) return;
    this.lastFrame = clock;
    setText(this.time, formatClock(clock.t));
    setText(this.date, formatDateLong(clock.t));
    const value = String(Math.round(clock.t));
    if (this.range.value !== value) this.range.value = value;
    this.range.style.setProperty('--p', `${percentOf(clock.t, clock.from, clock.to)}%`);
    setAttr(this.range, 'aria-valuetext', t('replay.scrubber.value', { time: formatClock(clock.t) }));
  }

  // ---- input ------------------------------------------------------------------------------------------------------

  private setSpeed(value: number): void {
    if (isSpeed(value)) this.ctx.replay.setSpeed(value);
  }

  private onRangeKey(event: KeyboardEvent): void {
    const clock = this.ctx.replay.clock;
    if (clock === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? BIG_SKIP_MS : SKIP_MS;
    const target = (key: string): (() => void) | undefined => {
      switch (key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          return () => this.ctx.replay.skip(-step);
        case 'ArrowRight':
        case 'ArrowUp':
          return () => this.ctx.replay.skip(step);
        case 'Home':
          return () => this.ctx.replay.seek(clock.from);
        case 'End':
          return () => this.ctx.replay.seek(clock.to);
        case 'PageUp':
        case 'PageDown': {
          const mark = markerStep(this.ctx.replay.markers, clock.t, key === 'PageDown' ? 1 : -1);
          return mark === undefined ? undefined : () => this.ctx.replay.seek(mark.at);
        }
        case ' ':
          return () => this.ctx.replay.togglePlay();
        default:
          return undefined;
      }
    };
    const run = target(event.key);
    if (run === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  }

  private showTip(event: PointerEvent): void {
    const clock = this.lastFrame;
    if (clock === undefined) return;
    const rect = this.range.getBoundingClientRect();
    const fraction = fractionAt(event.clientX, rect.left, rect.width);
    const at = clock.from + fraction * (clock.to - clock.from);
    const mark = markerNear(this.ctx.replay.markers, at, pixelsToMs(MARKER_REACH_PX, rect.width, clock.from, clock.to));
    const lines = [
      h('strong', null, formatClock(mark?.at ?? at)),
      ...(mark === undefined
        ? []
        : [
            h('span', null, describeMarker(mark)),
            ...(mark.count > 1
              ? [h('span', { class: 'ao-replay-tip-more' }, t('replay.marker.more', { n: mark.count - 1 }))]
              : []),
          ]),
    ];
    this.tip.replaceChildren(...lines);
    this.tip.hidden = false;
    this.tip.style.setProperty('--x', `${percentOf(mark?.at ?? at, clock.from, clock.to)}%`);
  }

  private hideTip(): void {
    this.tip.hidden = true;
  }
}

/** A subtle badge over the world, so the replay is never taken for the live office. */
export class ReplayBadge implements Component {
  readonly el = h('div', { class: 'ao-replay-badge', hidden: true, title: t('replay.pill.hint') });

  constructor(private readonly ctx: AppContext) {}

  render(): void {
    this.el.hidden = !this.ctx.replay.engaged;
    setText(this.el, t('replay.badge'));
  }
}
