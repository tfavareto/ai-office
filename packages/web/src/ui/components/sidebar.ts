// Sidebar: search, account filter chips, rooms with their agents and subagents.
import type { Agent } from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext, Component } from '../context';
import { accountLabel, activityText, agentRole, agentTitle, agentWaitingFor, permissionSummary } from '../display';
import { KeyedList, h, setAttr, setText, toggleClass, type KeyedEntry } from '../dom';
import { icon } from '../icons';
import { buildRooms, roomColor, type AgentRowModel, type RoomModel } from '../model/rooms';
import { displayStatus, primaryShell, statusLabel } from '../model/status';
import { createAvatar, liveText, setLive, setStatusDot, statusDot, updateAccountChip, accountChip } from '../widgets';

const AVATAR_SIZE = 30;
/** Portraits become available asynchronously; refresh the rows from time to time. */
const PORTRAIT_REFRESH_MS = 2000;

export class Sidebar implements Component {
  readonly el = h('aside', { class: 'ao-sidebar', 'aria-label': t('sidebar.label') });
  private readonly input: HTMLInputElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly chips = h('div', { class: 'ao-chips', role: 'group', 'aria-label': t('sidebar.accountFilter') });
  private readonly list = h('div', { class: 'ao-sidebar-list' });
  private readonly note = h('p', { class: 'ao-note ao-sidebar-note' });
  private readonly rooms: KeyedList<RoomModel>;
  private signature = '';
  private chipSignature = '';

  constructor(private readonly ctx: AppContext) {
    this.input = h('input', {
      type: 'search',
      class: 'ao-search-input',
      placeholder: t('sidebar.search'),
      'aria-label': t('sidebar.search'),
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.input.addEventListener('input', () => ctx.ui.set({ query: this.input.value }));
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.input.value) {
        event.stopPropagation();
        this.setQuery('');
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.list.querySelector<HTMLElement>('.ao-agent-row')?.focus();
      }
    });
    this.clearBtn = h('button', { type: 'button', class: 'ao-search-clear', 'aria-label': t('sidebar.search.clear'), hidden: true, onclick: () => this.setQuery('') }, icon('x', 14));
    const search = h('label', { class: 'ao-search' }, icon('search', 16), this.input, h('kbd', { class: 'ao-kbd' }, '/'), this.clearBtn);
    this.el.append(h('div', { class: 'ao-sidebar-head' }, search, this.chips), this.list, this.note);
    this.rooms = new KeyedList(this.list, (room) => room.project.id, (room) => this.createRoom(room));
    this.list.addEventListener('keydown', (event) => this.onListKey(event));
  }

  focusSearch(): void {
    this.input.focus();
    this.input.select();
  }

  private setQuery(query: string): void {
    this.input.value = query;
    this.ctx.ui.set({ query });
  }

  private onListKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(this.list.querySelectorAll<HTMLElement>('.ao-agent-row'));
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    event.preventDefault();
    const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
    else if (event.key === 'ArrowUp') this.input.focus();
  }

  render(): void {
    const ui = this.ctx.ui.get();
    const snapshot = this.ctx.snapshot;
    toggleClass(this.el, 'is-open', ui.sidebarOpen);
    setAttr(this.el, 'aria-hidden', String(!ui.sidebarOpen));
    if (ui.sidebarOpen) this.el.removeAttribute('inert');
    else this.el.setAttribute('inert', '');
    if (!ui.sidebarOpen || !snapshot) return;
    if (this.input.value !== ui.query) this.input.value = ui.query;
    this.clearBtn.hidden = ui.query.length === 0;

    this.renderChips();
    const selectedId = ui.selection?.type === 'agent' ? ui.selection.id : null;
    const signature = `${snapshot.rev}|${ui.query}|${ui.accountFilter.join(',')}|${ui.collapsedRooms.join(',')}|${ui.selection?.id ?? ''}|${Math.floor(this.ctx.now() / PORTRAIT_REFRESH_MS)}`;
    if (signature === this.signature) return;
    this.signature = signature;

    const rooms = buildRooms(snapshot, { query: ui.query, accountIds: ui.accountFilter }, selectedId);
    this.rooms.sync(rooms);
    const filtering = ui.query.trim().length > 0 || ui.accountFilter.length > 0;
    if (rooms.length === 0) {
      this.note.hidden = false;
      setText(this.note, filtering ? t('sidebar.empty.noResults') : t('sidebar.empty.noSessions'));
    } else {
      this.note.hidden = true;
    }
  }

  private renderChips(): void {
    const accounts = this.ctx.snapshot?.accounts ?? [];
    const selected = this.ctx.ui.get().accountFilter;
    const signature = `${accounts.map((a) => `${a.id}${a.label}${a.color}`).join(',')}|${selected.join(',')}`;
    if (signature === this.chipSignature) return;
    this.chipSignature = signature;
    this.chips.hidden = accounts.length < 2;
    this.chips.replaceChildren(
      ...accounts.map((account) => {
        const on = selected.includes(account.id);
        const chip = h(
          'button',
          { type: 'button', class: `ao-chip ${on ? 'is-on' : ''}`.trim(), 'aria-pressed': String(on), title: t('sidebar.accountOnly', { label: accountLabel(account) }), onclick: () => this.ctx.ui.toggleAccount(account.id) },
          accountChip(account),
          h('span', null, accountLabel(account)),
        );
        return chip;
      }),
    );
  }

  // --- rooms -------------------------------------------------------------------------------------------------------

  private createRoom(initial: RoomModel): KeyedEntry<RoomModel> {
    const swatch = h('span', { class: 'ao-room-swatch', 'aria-hidden': 'true' });
    const name = h('span', { class: 'ao-room-name' });
    const count = h('span', { class: 'ao-room-count' });
    const attention = h('span', { class: 'ao-room-attention', hidden: true });
    const progressBar = h('span', { class: 'ao-progress-bar' });
    const progress = h('span', { class: 'ao-progress', hidden: true }, progressBar);
    const progressText = h('span', { class: 'ao-room-tasks' });
    const toggle = h('button', { type: 'button', class: 'ao-room-toggle', 'aria-label': t('sidebar.room.toggle') }, icon('chevronDown', 16));
    const main = h('button', { type: 'button', class: 'ao-room-main' }, swatch, name, attention, count, progressText, progress);
    const rowsEl = h('div', { class: 'ao-room-rows' });
    const el = h('section', { class: 'ao-room' }, h('div', { class: 'ao-room-head' }, toggle, main), rowsEl);
    const rows = new KeyedList<AgentRowModel>(rowsEl, (row) => row.agent.id, (row) => this.createRow(row));
    let projectId = initial.project.id;

    toggle.addEventListener('click', () => this.ctx.ui.toggleRoom(projectId));
    main.addEventListener('click', () => this.ctx.selectRoom(projectId, { focus: true }));

    return {
      el,
      update: (room) => {
        projectId = room.project.id;
        const ui = this.ctx.ui.get();
        const collapsed = ui.collapsedRooms.includes(room.project.id);
        const selected = ui.selection?.type === 'room' && ui.selection.id === room.project.id;
        swatch.style.background = roomColor(room.project.seed);
        setText(name, room.project.name);
        main.title = room.project.path;
        setText(count, String(room.agentCount));
        attention.hidden = room.needsYou === 0;
        setText(attention, room.needsYou > 0 ? t('sidebar.room.needs', { n: room.needsYou }) : '');
        const hasTasks = room.tasksTotal > 0;
        progress.hidden = !hasTasks;
        progressText.hidden = !hasTasks;
        if (hasTasks) {
          progressBar.style.width = `${(room.tasksDone / room.tasksTotal) * 100}%`;
          setText(progressText, `${room.tasksDone}/${room.tasksTotal}`);
        }
        toggleClass(el, 'is-collapsed', collapsed);
        toggleClass(el, 'is-selected', selected);
        setAttr(toggle, 'aria-expanded', String(!collapsed));
        rowsEl.hidden = collapsed;
        if (!collapsed) rows.sync(room.rows);
      },
    };
  }

  // --- agent rows --------------------------------------------------------------------------------------------------

  private createRow(initial: AgentRowModel): KeyedEntry<AgentRowModel> {
    const avatar = createAvatar(AVATAR_SIZE);
    const dot = statusDot('idle');
    const name = h('span', { class: 'ao-row-name' });
    const account = h('span', { class: 'ao-account' });
    const role = h('span', { class: 'ao-row-role' });
    const activity = h('span', { class: 'ao-row-activity' });
    const status = h('span', { class: 'ao-row-status' });
    const time = liveText('ago', 0, 'ao-row-time');
    const shellIcon = h('span', { class: 'ao-row-shell', hidden: true }, icon('terminal', 12));
    const el = h(
      'button',
      { type: 'button', class: 'ao-agent-row' },
      h('span', { class: 'ao-row-avatar' }, avatar.el, dot),
      h('span', { class: 'ao-row-body' }, h('span', { class: 'ao-row-line' }, name, account, role), activity),
      h('span', { class: 'ao-row-meta' }, status, h('span', { class: 'ao-row-timeline' }, shellIcon, time)),
    );
    let agentId = initial.agent.id;
    el.addEventListener('click', () => this.ctx.selectAgent(agentId, { focus: true }));
    el.addEventListener('dblclick', () => this.ctx.selectAgent(agentId, { focus: true }));

    return {
      el,
      update: ({ agent, depth }) => {
        agentId = agent.id;
        const ds = displayStatus(agent);
        const selection = this.ctx.ui.get().selection;
        avatar.update(agent, this.ctx.world.portrait(agent.id, AVATAR_SIZE * 2));
        setStatusDot(dot, ds);
        setText(name, agent.name);
        updateAccountChip(account, this.ctx.account(agent.accountId));
        setText(role, agent.kind === 'sub' ? agentRole(agent) : this.mainRole(agent));
        setText(activity, this.activityText(agent));
        setText(status, statusLabel(ds));
        status.className = `ao-row-status ao-text--${ds}`;
        const shell = primaryShell(agent);
        shellIcon.hidden = !shell;
        if (shell) setLive(time, 'elapsed', shell.startedAt);
        else setLive(time, 'ago', agent.statusSince);
        el.dataset.depth = String(depth);
        el.setAttribute('aria-label', t('sidebar.row.label', { name: agent.name, status: statusLabel(ds) }));
        toggleClass(el, 'is-sub', depth === 1);
        toggleClass(el, 'is-selected', selection?.type === 'agent' && selection.id === agent.id);
        toggleClass(el, 'is-leaving', agent.status === 'offline' || agent.status === 'done');
      },
    };
  }

  private mainRole(agent: Agent): string {
    return agent.role && agent.role !== 'Principal' ? agentRole(agent) : '';
  }

  private activityText(agent: Agent): string {
    if (agent.status === 'waiting') return (agent.permission ? permissionSummary(agent.permission) : undefined) ?? agentWaitingFor(agent) ?? t('sidebar.row.needsYou');
    if (agent.activity) return `${agent.activity.icon} ${activityText(agent.activity)}`;
    return agentTitle(agent) ?? t('sidebar.row.noActivity');
  }
}
