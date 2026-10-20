// Task board: the tasks of every agent in three columns (or one lane per room). Moving a card sends a message to
// the right agent after a confirmation; the card shows "message sent" until a snapshot reflects the change.
import type { Agent } from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext } from '../context';
import { accountLabel } from '../display';
import { h, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import {
  BOARD_COLUMNS, DONE_PER_ROOM, boardOptions, buildBoard, buildCards, sanitizeFilter,
  type BoardCard, type BoardColumn, type BoardFilter, type BoardColumnId, type BoardLane, type BoardModel, type BoardView,
} from '../model/board';
import { buildMoveIntent, markFromIntent, type MoveIntent, type MoveTarget } from '../model/board-moves';
import { isLive } from '../model/status';
import { createAvatar, createSegmented, createSwitch, tickLive, type Segmented, type Switch } from '../widgets';
import { COLUMN_KEYS, createCard, roomTag, type CardView } from './board-card';
import { MoveMenu, type MenuOption } from './board-menu';
import { MessageSheet } from './board-sheet';
import { Dialog, closeButton } from './overlay';
import { compareBoardAgents } from '../../world/taskBoard';

export class BoardDialog extends Dialog {
  private readonly count = h('span', { class: 'ao-board-count' });
  private readonly body = h('div', { class: 'ao-board-body' });
  private readonly menu = new MoveMenu();
  private readonly sheet: MessageSheet;
  private readonly rail = h('div', { class: 'ao-board-rail', 'aria-hidden': 'true' });
  private readonly roomSelect = h('select', { class: 'ao-select', 'aria-label': t('board.filter.room') });
  private readonly accountSelect = h('select', { class: 'ao-select', 'aria-label': t('board.filter.account') });
  private readonly agentSelect = h('select', { class: 'ao-select', 'aria-label': t('board.filter.agent') });
  private readonly activeSwitch: Switch;
  private readonly grouping: Segmented<BoardView['grouping']>;
  private cards: CardView[] = [];
  private dragCard: BoardCard | null = null;
  private signature = '';
  private optionsSignature = '';

  constructor(ctx: AppContext) {
    super(ctx, 'board', 'ao-board-title', 'ao-dialog--board');
    this.sheet = new MessageSheet(ctx);
    this.activeSwitch = createSwitch(t('board.filter.onlyActive'), (on) => ctx.board.setFilter({ onlyActive: on }));
    this.grouping = createSegmented<BoardView['grouping']>(
      t('board.group.label'),
      [
        { value: 'column', label: t('board.group.column') },
        { value: 'room', label: t('board.group.room') },
      ],
      (value) => ctx.board.setGrouping(value),
    );
    this.roomSelect.addEventListener('change', () => ctx.board.setFilter({ roomId: this.roomSelect.value || null }));
    this.accountSelect.addEventListener('change', () => ctx.board.setFilter({ accountId: this.accountSelect.value || null }));
    this.agentSelect.addEventListener('change', () => ctx.board.setFilter({ agentId: this.agentSelect.value || null }));

    const filters = h(
      'div',
      { class: 'ao-board-filters', role: 'group', 'aria-label': t('board.filters') },
      this.roomSelect,
      this.accountSelect,
      this.agentSelect,
      h('span', { class: 'ao-switch-row ao-board-active' }, this.activeSwitch.el, h('span', null, t('board.filter.onlyActive'))),
    );
    this.panel.append(
      h(
        'header',
        { class: 'ao-dialog-head ao-board-head' },
        h('div', { class: 'ao-board-headline' }, h('h2', { id: 'ao-board-title' }, t('board.title')), this.count),
        this.grouping.el,
        closeButton(t('common.close'), () => ctx.closeDialog()),
      ),
      h('div', { class: 'ao-board-toolbar' }, filters),
      this.body,
      this.rail,
      this.menu.el,
      this.sheet.el,
    );
    this.el.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.panel.addEventListener('pointerdown', (event) => {
      if (this.menu.isOpen && event.target instanceof Node && !this.menu.el.contains(event.target)) this.menu.close(false);
    });
  }

  protected onOpen(): void {
    this.signature = '';
    this.menu.close(false);
    this.sheet.close();
  }

  protected update(): void {
    const ctx = this.ctx;
    const snapshot = ctx.snapshot;
    const clean = sanitizeFilter(ctx.board.get().filter, snapshot);
    if (clean !== ctx.board.get().filter) ctx.board.resetFilter(clean);
    ctx.board.reconcile(buildCards(snapshot), ctx.now());
    const state = ctx.board.get();
    const model = buildBoard(snapshot, state.filter, state.view, state.sent);

    setText(this.count, t('board.count', { n: model.total }));
    this.grouping.set(state.view.grouping);
    this.activeSwitch.set(state.filter.onlyActive);
    this.renderFilters(state.filter);
    for (const card of this.cards) card.refreshAvatar();

    const signature = this.signatureOf(model, state.view.showAllDone);
    if (signature === this.signature || this.dragCard !== null) return;
    this.signature = signature;
    this.renderBody(model, state.view);
  }

  // --- filters ---------------------------------------------------------------------------------------------------

  private renderFilters(filter: BoardFilter): void {
    const ctx = this.ctx;
    const options = boardOptions(ctx.snapshot, filter);
    const signature = [options.rooms.map((room) => room.id), options.accounts, options.agents.map((agent) => agent.id)].map((list) => list.join(',')).join('|');
    if (signature !== this.optionsSignature) {
      this.optionsSignature = signature;
      this.roomSelect.replaceChildren(h('option', { value: '' }, t('board.filter.allRooms')), ...options.rooms.map((room) => h('option', { value: room.id }, room.name)));
      this.accountSelect.replaceChildren(
        h('option', { value: '' }, t('board.filter.allAccounts')),
        ...options.accounts.map((id) => {
          const account = ctx.account(id);
          return h('option', { value: id }, account ? accountLabel(account) : id);
        }),
      );
      this.agentSelect.replaceChildren(h('option', { value: '' }, t('board.filter.allAgents')), ...options.agents.map((agent) => h('option', { value: agent.id }, agent.name)));
    }
    this.roomSelect.value = filter.roomId ?? '';
    this.accountSelect.value = filter.accountId ?? '';
    this.agentSelect.value = filter.agentId ?? '';
    this.accountSelect.hidden = options.accounts.length < 2;
  }

  // --- body ------------------------------------------------------------------------------------------------------

  private signatureOf(model: BoardModel, showAll: boolean): string {
    const column = (c: BoardColumn): string => `${c.id}:${c.hidden}:${c.cards.map((card) => `${card.key}/${card.label}/${card.sent?.id ?? ''}`).join(',')}`;
    const lanes = model.lanes.map((lane) => `${lane.project.id}[${lane.agents.map((a) => a.id).join(',')}]${lane.columns.map(column).join(';')}`).join('|');
    return [model.grouping, showAll, model.total, this.ctx.isLocal, model.taskless.map((a) => a.id).join(','), lanes].join('#');
  }

  private renderBody(model: BoardModel, view: BoardView): void {
    const focusedKey = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.card : undefined;
    this.cards = [];
    const filtered = this.ctx.board.get().filter;
    const isFiltered = filtered.roomId !== null || filtered.accountId !== null || filtered.agentId !== null || filtered.onlyActive;
    const children: Node[] = [];
    if (model.total === 0) {
      children.push(
        isFiltered
          ? h('p', { class: 'ao-board-empty' }, t('board.empty.filtered'))
          : h('div', { class: 'ao-board-empty' }, h('strong', null, t('board.empty.title')), h('p', null, t('board.empty.body'))),
      );
    }
    if (view.grouping === 'column') children.push(this.columnsEl(model.columns, null, true));
    else for (const lane of model.lanes) children.push(this.laneEl(lane));
    if (model.taskless.length > 0) children.push(this.tasklessEl(model.taskless));
    this.body.replaceChildren(...children);
    for (const card of this.cards) card.refreshAvatar();
    tickLive(this.body, this.ctx.now());
    if (focusedKey) this.body.querySelector<HTMLElement>(`[data-card="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
  }

  private laneEl(lane: BoardLane): HTMLElement {
    const hasCards = lane.columns.some((column) => column.total > 0);
    return h(
      'section',
      { class: 'ao-blane', 'aria-label': lane.project.name },
      h('header', { class: 'ao-blane-head' }, roomTag(lane.project.name, lane.project.seed), h('span', { class: 'ao-blane-agents' }, t('board.lane.agents', { n: lane.agents.length }))),
      hasCards ? null : h('p', { class: 'ao-note' }, t('board.lane.noTasks')),
      this.columnsEl(lane.columns, lane, false),
    );
  }

  private columnsEl(columns: readonly BoardColumn[], lane: BoardLane | null, showRoom: boolean): HTMLElement {
    return h('div', { class: 'ao-board-cols' }, ...columns.map((column) => this.columnEl(column, lane, showRoom)));
  }

  private columnEl(column: BoardColumn, lane: BoardLane | null, showRoom: boolean): HTMLElement {
    const name = t(COLUMN_KEYS[column.id]);
    const list = h('ul', { class: 'ao-bcol-list', 'aria-label': name });
    for (const card of column.cards) {
      const view = createCard(this.ctx, card, this.handlers, { showRoom });
      this.cards.push(view);
      list.append(view.el);
    }
    if (column.cards.length === 0) list.append(h('li', { class: 'ao-bcol-empty' }, t('board.column.empty')));
    const add = h('button', { type: 'button', class: 'ao-iconbtn ao-iconbtn--small', 'aria-label': t('board.add.column', { column: name }), title: t('board.add.column', { column: name }) }, icon('plus', 14));
    add.addEventListener('click', () => this.openAdd(column.id, lane, add));
    const el = h(
      'section',
      { class: `ao-bcol is-${column.id}`, 'data-column': column.id },
      h('header', { class: 'ao-bcol-head' }, h('h3', null, name), h('span', { class: 'ao-bcol-count' }, String(column.total)), add),
      list,
      column.id === 'completed' ? this.doneToggle(column) : null,
    );
    list.addEventListener('dragover', (event) => {
      if (!this.dragCard) return;
      event.preventDefault();
      el.classList.add('is-over');
    });
    list.addEventListener('dragleave', () => el.classList.remove('is-over'));
    list.addEventListener('drop', (event) => {
      event.preventDefault();
      el.classList.remove('is-over');
      this.dropOn({ column: column.id });
    });
    return el;
  }

  private doneToggle(column: BoardColumn): HTMLElement | null {
    const showAll = this.ctx.board.get().view.showAllDone;
    if (column.hidden === 0 && !(showAll && column.total > DONE_PER_ROOM)) return null;
    const label = column.hidden > 0 ? t('board.done.showAll', { n: column.total }) : t('board.done.showLess');
    return h('button', { type: 'button', class: 'ao-btn ao-btn--ghost ao-btn--small ao-bcol-more', onclick: () => this.ctx.board.toggleShowAllDone() }, label);
  }

  private tasklessEl(agents: readonly Agent[]): HTMLElement {
    return h(
      'div',
      { class: 'ao-board-taskless' },
      h('span', null, t('board.taskless')),
      ...agents.map((agent) => {
        const avatar = createAvatar(18);
        avatar.update(agent, this.ctx.world.portrait(agent.id, 36));
        return h('button', { type: 'button', class: 'ao-chip', onclick: () => this.openAgent(agent.id) }, avatar.el, agent.name);
      }),
    );
  }

  // --- card actions ----------------------------------------------------------------------------------------------

  private readonly handlers = {
    open: (card: BoardCard): void => {
      this.ctx.board.focusTask(card.agentId, card.taskId, this.ctx.now());
      this.openAgent(card.agentId);
    },
    move: (card: BoardCard, anchor: HTMLElement): void => this.openMenu(card, anchor),
    dragStart: (card: BoardCard): void => this.startDrag(card),
    dragEnd: (): void => this.endDrag(),
  };

  private openAgent(agentId: string): void {
    this.ctx.selectAgent(agentId, { focus: true, tab: 'summary' });
    this.ctx.closeDialog();
  }

  private assignees(except: string): Agent[] {
    const agents = this.ctx.snapshot?.agents ?? [];
    return agents.filter((agent) => agent.kind === 'main' && isLive(agent) && agent.id !== except).sort(compareBoardAgents(this.ctx.snapshot?.projects ?? []));
  }

  private nameOf = (agentId: string): string => this.ctx.agent(agentId)?.name ?? t('agent.fallback');

  private agentLabel(agent: Agent): string {
    return `${agent.name} · ${this.ctx.project(agent.projectId)?.name ?? ''}`;
  }

  private openMenu(card: BoardCard, anchor: HTMLElement): void {
    const options: MenuOption[] = [];
    for (const column of BOARD_COLUMNS) {
      const intent = buildMoveIntent(card, { column }, this.nameOf);
      if (intent) options.push({ group: 'column', label: t('board.menu.toColumn', { column: t(COLUMN_KEYS[column]) }), run: () => this.confirm(intent, anchor) });
    }
    for (const agent of this.assignees(card.agentId)) {
      const intent = buildMoveIntent(card, { agentId: agent.id }, this.nameOf);
      if (intent) options.push({ group: 'agent', label: t('board.menu.toAgent', { name: this.agentLabel(agent) }), run: () => this.confirm(intent, anchor) });
    }
    this.menu.open(anchor, this.panel, t('board.menu.title', { task: card.title }), options);
  }

  private confirm(intent: MoveIntent, opener: HTMLElement | null): void {
    this.sheet.openMove(intent, this.nameOf(intent.recipientId), opener, (final, text) => this.deliver(final, text));
  }

  private async deliver(intent: MoveIntent, text: string): Promise<void> {
    await this.ctx.sendMessage([intent.recipientId], text);
    this.ctx.board.addSent(markFromIntent(intent, this.ctx.board.nextMarkId(), this.ctx.now()));
    this.signature = '';
  }

  private openAdd(column: BoardColumnId, lane: BoardLane | null, opener: HTMLElement): void {
    const state = this.ctx.board.get();
    const model = buildBoard(this.ctx.snapshot, state.filter, state.view, []);
    const agents = lane ? lane.agents : model.lanes.flatMap((l) => l.agents);
    if (agents.length === 0) {
      this.ctx.announce(t('board.add.noAgents'));
      return;
    }
    const choices = agents.map((agent) => ({ id: agent.id, label: this.agentLabel(agent) }));
    this.sheet.openAdd(column, choices, state.filter.agentId, opener, (intent, text) => this.deliver(intent, text));
  }

  // --- drag and drop ---------------------------------------------------------------------------------------------

  private startDrag(card: BoardCard): void {
    this.dragCard = card;
    this.menu.close(false);
    const targets = card.status === 'completed' ? [] : this.assignees(card.agentId);
    this.rail.replaceChildren(
      h('span', { class: 'ao-board-rail-label' }, t('board.rail')),
      ...targets.map((agent) => {
        const chip = h('span', { class: 'ao-chip ao-board-rail-chip', 'data-agent': agent.id }, this.railAvatar(agent), this.agentLabel(agent));
        chip.addEventListener('dragover', (event) => {
          event.preventDefault();
          chip.classList.add('is-over');
        });
        chip.addEventListener('dragleave', () => chip.classList.remove('is-over'));
        chip.addEventListener('drop', (event) => {
          event.preventDefault();
          this.dropOn({ agentId: agent.id });
        });
        return chip;
      }),
    );
    toggleClass(this.rail, 'is-visible', targets.length > 0);
    toggleClass(this.panel, 'is-dragging', true);
  }

  private railAvatar(agent: Agent): HTMLElement {
    const avatar = createAvatar(18);
    avatar.update(agent, this.ctx.world.portrait(agent.id, 36));
    return avatar.el;
  }

  private endDrag(): void {
    this.dragCard = null;
    toggleClass(this.rail, 'is-visible', false);
    toggleClass(this.panel, 'is-dragging', false);
    for (const el of this.body.querySelectorAll('.is-over')) el.classList.remove('is-over');
    this.signature = '';
    this.ctx.refresh();
  }

  private dropOn(target: MoveTarget): void {
    const card = this.dragCard;
    this.endDrag();
    if (!card) return;
    const intent = buildMoveIntent(card, target, this.nameOf);
    if (intent) this.confirm(intent, this.body.querySelector<HTMLElement>(`[data-card="${CSS.escape(card.key)}"]`));
  }

  // --- keyboard --------------------------------------------------------------------------------------------------

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.sheet.isOpen) {
        event.preventDefault();
        this.sheet.close();
      } else if (this.menu.isOpen) {
        event.preventDefault();
        this.menu.close();
      }
      return;
    }
    this.menu.onKeyDown(event);
  }
}
