// The floor of a room, in its panel: what it is, and landing or removing it. Each of those writes to the repository, so
// each needs a second click. What git refuses (unsaved work, a conflict) comes back as a sentence that says what to do.
import type { FloorInfo } from '@ai-office/shared';
import { t, type TextKey } from '../../i18n';
import { describeError } from '../../net/backend';
import type { AppContext } from '../../ui/context';
import { h, setText, toggleClass } from '../../ui/dom';
import { floorErrorKey } from '../model/floor';

const CONFIRM_MS = 3000;

type FloorAction = 'merge' | 'pr' | 'remove';

const ACTION_LABEL: Record<FloorAction, TextKey> = {
  merge: 'pro.floor.merge',
  pr: 'pro.floor.pr',
  remove: 'pro.floor.remove',
};

export class FloorSection {
  readonly el = h('section', { class: 'ao-pro-floor', hidden: true });
  private readonly line = h('p', { class: 'ao-pro-floor-line' });
  private readonly dirty = h('p', { class: 'ao-pro-floor-dirty', hidden: true }, t('pro.floor.dirty'));
  private readonly note = h('p', { class: 'ao-pro-floor-note', 'aria-live': 'polite' });
  private readonly buttons: Record<FloorAction, HTMLButtonElement>;
  private roomId: string | null = null;
  private armed: FloorAction | null = null;
  private armTimer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private target = '';
  /** The person was told removing also deletes ignored files, and asked to remove anyway. */
  private acceptIgnored = false;

  constructor(private readonly ctx: AppContext) {
    const make = (action: FloorAction): HTMLButtonElement =>
      h(
        'button',
        { type: 'button', class: 'ao-btn ao-btn--soft', onclick: () => void this.onClick(action) },
        t(ACTION_LABEL[action]),
      );
    this.buttons = { merge: make('merge'), pr: make('pr'), remove: make('remove') };
    this.el.append(
      h('h3', { class: 'ao-pro-panel-h' }, t('pro.floor.title')),
      this.line,
      this.dirty,
      h('div', { class: 'ao-pro-floor-actions' }, this.buttons.merge, this.buttons.pr, this.buttons.remove),
      this.note,
    );
  }

  /** Reads what the room is; a room that is not a floor shows nothing. */
  show(roomId: string): void {
    this.roomId = roomId;
    this.el.hidden = true;
    this.disarm();
    setText(this.note, '');
    this.acceptIgnored = false;
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const roomId = this.roomId;
    if (roomId === null || !this.ctx.isLocal) return;
    const info: FloorInfo = await this.ctx.store.backend.floorStatus(roomId).catch(() => ({ isFloor: false }));
    if (roomId !== this.roomId) return;
    this.el.hidden = !info.isFloor;
    if (!info.isFloor) return;
    setText(
      this.line,
      `${t('pro.floor.line', { branch: info.branch, target: info.target })} · ${t('pro.floor.ahead', { n: info.ahead })}`,
    );
    this.target = info.target;
    this.dirty.hidden = !info.dirty;
  }

  private async onClick(action: FloorAction): Promise<void> {
    if (this.busy) return;
    if (this.armed !== action) {
      this.disarm();
      this.armed = action;
      toggleClass(this.buttons[action], 'is-armed', true);
      setText(this.buttons[action], t('pro.floor.confirm'));
      this.armTimer = setTimeout(() => this.disarm(), CONFIRM_MS);
      return;
    }
    this.disarm();
    await this.run(action);
  }

  private disarm(): void {
    if (this.armTimer !== null) clearTimeout(this.armTimer);
    this.armTimer = null;
    if (this.armed !== null) {
      toggleClass(this.buttons[this.armed], 'is-armed', false);
      setText(this.buttons[this.armed], t(ACTION_LABEL[this.armed]));
    }
    this.armed = null;
  }

  private async run(action: FloorAction): Promise<void> {
    const roomId = this.roomId;
    if (roomId === null) return;
    const backend = this.ctx.store.backend;
    this.busy = true;
    try {
      if (action === 'remove') {
        const { branchKept } = await backend.removeFloor(roomId, this.acceptIgnored);
        setText(this.note, t(branchKept ? 'pro.floor.removedKept' : 'pro.floor.removed'));
      } else if (action === 'merge') {
        await backend.landFloor(roomId, 'merge');
        setText(this.note, t('pro.floor.merged', { target: this.target }));
      } else {
        const { url } = await backend.landFloor(roomId, 'pull-request');
        setText(this.note, t('pro.floor.opened', { url: url ?? '' }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'floor-has-ignored') this.acceptIgnored = true;
      const key = floorErrorKey(message);
      setText(this.note, key !== undefined ? t(key) : describeError(error));
    } finally {
      this.busy = false;
      await this.refresh();
    }
  }
}
