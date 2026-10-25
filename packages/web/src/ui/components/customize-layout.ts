// "Organizar salas": the slots of the building and the rooms in them. Rooms are reordered by dragging (on the plan of
// the slots or in the list) or with the move buttons; each can be pinned to the front or hidden from the building.
import type { Project } from '@ai-office/shared';
import { t } from '../../i18n';
import { slotPosition } from '../../layout/slots';
import { type LayoutDraft, draftFromRooms, draftOrder, layoutPatch, moveBy, moveItem } from '../../layout/arrange';
import type { AppContext } from '../context';
import { h, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import { roomColor } from '../model/rooms';
import { button, emptyNote } from '../widgets';

const DRAG_TYPE = 'text/x-ai-office-room';

function colorOf(project: Project): string {
  return project.theme?.color ?? roomColor(project.seed);
}

export class LayoutEditor {
  readonly el = h('div', { class: 'ao-cz-body' });
  private draft: LayoutDraft = { ids: [], pinned: new Set(), hidden: new Set() };
  private saving = false;
  private error = '';
  private dragId: string | null = null;
  private signature = '';
  private focusAfter: string | null = null;

  private readonly help = h('p', { class: 'ao-cz-hint' }, t('customize.layout.help'));
  private readonly plan = h('div', { class: 'ao-cz-plan', role: 'group', 'aria-label': t('customize.layout.slots') });
  private readonly list = h('ul', { class: 'ao-cz-rooms' });
  private readonly empty = emptyNote(t('customize.layout.empty'));
  private readonly errorBox = h('p', { class: 'ao-error', role: 'alert', hidden: true });
  private readonly saveBtn: HTMLButtonElement;
  private readonly saveLabel: HTMLElement;
  private readonly restoreBtn: HTMLButtonElement;

  constructor(
    private readonly ctx: AppContext,
    private readonly close: () => void,
  ) {
    this.saveBtn = button({
      label: t('customize.save'),
      icon: 'check',
      variant: 'primary',
      onClick: () => void this.save(),
    });
    this.saveLabel = this.saveBtn.querySelector('span') as HTMLElement;
    this.restoreBtn = button({
      label: t('customize.layout.restore'),
      icon: 'reset',
      variant: 'ghost',
      onClick: () => void this.restoreOrder(),
    });
    this.el.append(
      this.help,
      h('span', { class: 'ao-cz-label' }, t('customize.layout.slots')),
      this.plan,
      h('span', { class: 'ao-cz-label' }, t('customize.layout.rooms')),
      this.list,
      this.empty,
      this.errorBox,
      h(
        'div',
        { class: 'ao-cz-foot' },
        this.restoreBtn,
        h('span', { class: 'ao-cz-spacer' }),
        button({ label: t('common.cancel'), variant: 'ghost', onClick: () => this.close() }),
        this.saveBtn,
      ),
    );
  }

  private get rooms(): readonly Project[] {
    return this.ctx.snapshot?.projects ?? [];
  }

  open(): void {
    this.saving = false;
    this.error = '';
    this.signature = '';
    this.draft = draftFromRooms(this.rooms);
    void this.ctx.customization.load();
  }

  title(): string {
    return t('customize.layout.title');
  }

  private order(): string[] {
    return draftOrder(this.draft);
  }

  private shown(): string[] {
    return this.order().filter((id) => !this.draft.hidden.has(id));
  }

  private setDraft(next: Partial<LayoutDraft>): void {
    this.draft = { ...this.draft, ...next };
    this.ctx.refresh();
  }

  private move(id: string, delta: -1 | 1): void {
    this.focusAfter = `${id}|${delta === -1 ? 'up' : 'down'}`;
    this.setDraft({ ids: moveBy(this.order(), id, delta) });
  }

  private drop(targetId: string): void {
    const dragged = this.dragId;
    this.dragId = null;
    if (dragged === null || dragged === targetId) return;
    const order = this.order();
    this.focusAfter = null;
    this.setDraft({ ids: moveItem(order, order.indexOf(dragged), order.indexOf(targetId)) });
  }

  private toggle(kind: 'pinned' | 'hidden', id: string): void {
    const next = new Set(this.draft[kind]);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.setDraft({ [kind]: next });
  }

  private async save(): Promise<void> {
    if (this.saving) return;
    const patch = layoutPatch(this.rooms, this.draft, this.ctx.customization.get().document.order);
    await this.send(patch);
  }

  /** Forgets the order and every pin and hide: rooms go back to the order they arrived in. */
  private async restoreOrder(): Promise<void> {
    if (this.saving) return;
    const rooms = Object.fromEntries(
      Object.keys(this.ctx.customization.get().document.rooms).map((id) => [id, { pinned: null, hidden: null }]),
    );
    await this.send({ order: null, rooms });
  }

  private async send(patch: object): Promise<void> {
    this.saving = true;
    this.error = '';
    this.ctx.refresh();
    const outcome = await this.ctx.customization.change(patch);
    this.saving = false;
    if (outcome.ok) {
      this.ctx.announce(t('announce.customize.saved'));
      this.close();
    } else {
      this.error = outcome.message;
      this.ctx.announce(outcome.message);
    }
    this.ctx.refresh();
  }

  private chip(project: Project, slot: number): HTMLElement {
    const chip = h(
      'div',
      { class: 'ao-cz-slot', draggable: 'true', 'data-room': project.id, title: project.name },
      h('span', { class: 'ao-cz-slotnum' }, String(slot + 1)),
      h('span', { class: 'ao-cz-slotdot', style: `background:${colorOf(project)}` }),
      h('span', { class: 'ao-cz-slotname' }, project.name),
    );
    this.bindDrag(chip, project.id);
    return chip;
  }

  private bindDrag(el: HTMLElement, id: string): void {
    el.addEventListener('dragstart', (event) => {
      this.dragId = id;
      event.dataTransfer?.setData(DRAG_TYPE, id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      toggleClass(el, 'is-dragging', true);
    });
    el.addEventListener('dragend', () => {
      this.dragId = null;
      toggleClass(el, 'is-dragging', false);
      for (const over of this.el.querySelectorAll('.is-over')) over.classList.remove('is-over');
    });
    el.addEventListener('dragover', (event) => {
      if (this.dragId === null || this.dragId === id) return;
      event.preventDefault();
      toggleClass(el, 'is-over', true);
    });
    el.addEventListener('dragleave', () => toggleClass(el, 'is-over', false));
    el.addEventListener('drop', (event) => {
      event.preventDefault();
      this.drop(id);
    });
  }

  private renderPlan(byId: Map<string, Project>): void {
    const shown = this.shown();
    const rows = { north: [] as HTMLElement[], south: [] as HTMLElement[] };
    shown.forEach((id, slot) => {
      const project = byId.get(id);
      if (project) rows[slotPosition(slot).row].push(this.chip(project, slot));
    });
    const row = (label: string, chips: HTMLElement[]): HTMLElement =>
      h(
        'div',
        { class: 'ao-cz-planrow' },
        h('span', { class: 'ao-cz-planlabel' }, label),
        h('div', { class: 'ao-cz-slots' }, ...chips),
      );
    this.plan.replaceChildren(
      row(t('customize.layout.row.north'), rows.north),
      h('div', { class: 'ao-cz-corridor' }, t('customize.layout.corridor')),
      row(t('customize.layout.row.south'), rows.south),
    );
  }

  private rowFor(
    project: Project,
    position: number,
    count: number,
    groupStart: boolean,
    groupEnd: boolean,
  ): HTMLElement {
    const id = project.id;
    const hidden = this.draft.hidden.has(id);
    const pinned = this.draft.pinned.has(id);
    const iconButton = (
      name: Parameters<typeof icon>[0],
      label: string,
      onClick: () => void,
      pressed?: boolean,
      disabled = false,
      key = '',
    ): HTMLButtonElement => {
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'ao-iconbtn ao-iconbtn--small ao-cz-rowbtn',
          'aria-label': label,
          title: label,
          'data-key': key || null,
          ...(pressed !== undefined ? { 'aria-pressed': String(pressed) } : {}),
          ...(disabled ? { disabled: true } : {}),
        },
        icon(name, 15),
      );
      btn.addEventListener('click', onClick);
      return btn;
    };
    const el = h(
      'li',
      {
        class: `ao-cz-room ${hidden ? 'is-hidden' : ''} ${pinned ? 'is-pinned' : ''}`.trim(),
        draggable: hidden ? null : 'true',
      },
      h('span', { class: 'ao-cz-grip', 'aria-hidden': 'true' }, icon('grip', 15)),
      h('span', { class: 'ao-cz-slotdot', style: `background:${colorOf(project)}` }),
      h(
        'span',
        { class: 'ao-cz-roomname' },
        h('strong', null, project.name),
        h(
          'span',
          null,
          hidden ? t('customize.layout.hiddenNote') : t('customize.layout.position', { n: position + 1, total: count }),
        ),
      ),
      hidden
        ? null
        : iconButton(
            'arrowUp',
            t('customize.layout.up', { name: project.name }),
            () => this.move(id, -1),
            undefined,
            groupStart,
            `${id}|up`,
          ),
      hidden
        ? null
        : iconButton(
            'arrowDown',
            t('customize.layout.down', { name: project.name }),
            () => this.move(id, 1),
            undefined,
            groupEnd,
            `${id}|down`,
          ),
      iconButton(
        'pin',
        t(pinned ? 'customize.layout.unpin' : 'customize.layout.pin', { name: project.name }),
        () => this.toggle('pinned', id),
        pinned,
        hidden,
      ),
      iconButton(
        'eyeOff',
        t(hidden ? 'customize.layout.show' : 'customize.layout.hide', { name: project.name }),
        () => this.toggle('hidden', id),
        hidden,
      ),
    );
    if (!hidden) this.bindDrag(el, id);
    return el;
  }

  private renderList(byId: Map<string, Project>): void {
    const order = this.order().filter((id) => byId.has(id));
    const shown = order.filter((id) => !this.draft.hidden.has(id));
    const pinnedCount = shown.filter((id) => this.draft.pinned.has(id)).length;
    const items: HTMLElement[] = [];
    shown.forEach((id, index) => {
      const pinned = this.draft.pinned.has(id);
      const groupStart = pinned ? index === 0 : index === pinnedCount;
      const groupEnd = pinned ? index === pinnedCount - 1 : index === shown.length - 1;
      items.push(this.rowFor(byId.get(id) as Project, index, shown.length, groupStart, groupEnd));
    });
    for (const id of order.filter((candidate) => this.draft.hidden.has(candidate)))
      items.push(this.rowFor(byId.get(id) as Project, 0, 0, true, true));
    this.list.replaceChildren(...items);
    if (this.focusAfter !== null) {
      const target = this.list.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(this.focusAfter)}"]`);
      const fallback = this.focusAfter.endsWith('|up') ? 'down' : 'up';
      (target && !target.disabled
        ? target
        : this.list.querySelector<HTMLButtonElement>(
            `[data-key="${CSS.escape(this.focusAfter.replace(/\|(up|down)$/, `|${fallback}`))}"]`,
          )
      )?.focus();
      this.focusAfter = null;
    }
  }

  update(): void {
    const byId = new Map(this.rooms.map((room) => [room.id, room]));
    const known = new Set(this.draft.ids);
    // A room that arrived or left while the editor is open joins the draft (at the end) or drops out of it.
    if (this.rooms.some((room) => !known.has(room.id)) || this.draft.ids.some((id) => !byId.has(id))) {
      const ids = [
        ...this.draft.ids.filter((id) => byId.has(id)),
        ...this.rooms.filter((room) => !known.has(room.id)).map((room) => room.id),
      ];
      this.draft = { ...this.draft, ids };
    }
    const state = this.ctx.customization.get();
    const signature = `${this.order().join(',')}|${[...this.draft.pinned].join(',')}|${[...this.draft.hidden].join(',')}|${this.rooms
      .map((room) => `${room.id}${room.name}${colorOf(room)}`)
      .join(',')}`;
    if (signature !== this.signature) {
      this.signature = signature;
      this.renderPlan(byId);
      this.renderList(byId);
    }
    this.empty.hidden = this.rooms.length > 0;
    const busy = this.saving || state.busy;
    this.errorBox.hidden = this.error === '' && state.status !== 'error';
    setText(this.errorBox, this.error || state.error);
    this.saveBtn.disabled = busy || state.status !== 'ready';
    this.restoreBtn.disabled =
      busy ||
      state.status !== 'ready' ||
      (state.document.order.length === 0 && Object.keys(state.document.rooms).length === 0);
    setText(this.saveLabel, this.saving ? t('customize.saving') : t('customize.save'));
  }
}
