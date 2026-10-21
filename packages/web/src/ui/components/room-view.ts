// Drawer content for a selected room: hero, accounts, agents, team message composer, tasks, recent activity.
import type { Agent } from '@ai-office/shared';
import { t } from '../../i18n';
import { localOnlyHint, type AppContext, type Component } from '../context';
import { activityText, agentRole, taskLabel } from '../display';
import { h, setText } from '../dom';
import { formatClock } from '../format';
import { icon } from '../icons';
import { agentsOfProject, roomColor } from '../model/rooms';
import { displayStatus, statusLabel } from '../model/status';
import { roomActivities } from '../model/timeline';
import { accountChip, button, createAvatar, emptyNote, sectionTitle, setDisabled, setStatusDot, statusDot } from '../widgets';
import { GitSection } from './git-section';
import { MessageComposer } from './message-composer';
import { MessageHistory } from './message-history';
import { closeButton } from './overlay';

export class RoomView implements Component {
  readonly el = h('div', { class: 'ao-roomview' });
  private roomId: string | null = null;
  private readonly swatch = h('span', { class: 'ao-room-hero-swatch', 'aria-hidden': 'true' });
  private readonly name = h('h2', { class: 'ao-hero-name', id: 'ao-drawer-title' });
  private readonly path = h('code', { class: 'ao-room-path' });
  private readonly stats = h('div', { class: 'ao-room-stats' });
  private readonly accounts = h('div', { class: 'ao-block' });
  private readonly repo: GitSection;
  private readonly agents = h('div', { class: 'ao-block' });
  private readonly tasks = h('div', { class: 'ao-block' });
  private readonly activity = h('div', { class: 'ao-block' });
  private readonly composer: MessageComposer;
  private readonly hireBtn: HTMLButtonElement;
  private readonly history: MessageHistory;
  private readonly body = h('div', { class: 'ao-agent-body' });
  private readonly gone = h('div', { class: 'ao-gone', hidden: true }, emptyNote(t('room.gone')));
  private signatures = { stats: '', accounts: '', agents: '', tasks: '', activity: '' };

  constructor(private readonly ctx: AppContext) {
    this.repo = new GitSection(ctx);
    this.history = new MessageHistory(ctx, (id) => ctx.agent(id)?.name ?? t('agent.fallback'));
    this.composer = new MessageComposer(ctx, () => this.history.refreshNow());
    const copy = h(
      'button',
      { type: 'button', class: 'ao-iconbtn ao-iconbtn--small', 'aria-label': t('room.copyPath'), title: t('room.copyPath'), onclick: () => this.copyPath() },
      icon('copy', 14),
    );
    const hero = h(
      'header',
      { class: 'ao-hero ao-hero--room' },
      this.swatch,
      h('div', { class: 'ao-hero-info' }, this.name, h('div', { class: 'ao-room-path-row' }, this.path, copy)),
      closeButton(t('drawer.close'), () => ctx.clearSelection()),
    );
    this.hireBtn = button({ label: t('hire.action'), icon: 'plus', variant: 'soft', className: 'ao-room-hirebtn', onClick: () => this.roomId && this.ctx.openHire({ projectPath: this.roomId }) });
    this.body.append(
      this.stats,
      this.accounts,
      this.repo.el,
      this.agents,
      this.hireBtn,
      h('div', { class: 'ao-block' }, sectionTitle(t('room.team.title')), this.composer.el, this.history.el),
      this.tasks,
      this.activity,
    );
    this.el.append(hero, this.body, this.gone);
  }

  setRoom(id: string): void {
    if (this.roomId === id) return;
    this.roomId = id;
    this.history.setActive(true);
  }

  deactivate(): void {
    this.history.setActive(false);
    this.roomId = null;
  }

  private copyPath(): void {
    const project = this.roomId ? this.ctx.project(this.roomId) : undefined;
    if (project) this.ctx.copy(project.path, t('room.pathCopied'));
  }

  render(): void {
    const project = this.roomId ? this.ctx.project(this.roomId) : undefined;
    this.body.hidden = !project;
    this.gone.hidden = project !== undefined;
    if (!project || !this.roomId) return;
    const agents = agentsOfProject(this.ctx.snapshot, this.roomId);
    this.swatch.style.background = roomColor(project.seed);
    setText(this.name, project.name);
    setText(this.path, project.path);
    setDisabled(this.hireBtn, !this.ctx.isLocal, localOnlyHint());
    this.renderStats(agents);
    this.renderAccounts(agents);
    this.repo.update(project);
    this.renderAgents(agents);
    this.renderTeam(project.name, agents);
    this.renderTasks(agents);
    this.renderActivity(agents);
  }

  private renderStats(agents: Agent[]): void {
    const working = agents.filter((a) => a.status === 'working').length;
    const needs = agents.filter((a) => a.status === 'waiting').length;
    const signature = `${agents.length}|${working}|${needs}`;
    if (signature === this.signatures.stats) return;
    this.signatures.stats = signature;
    const stat = (value: number, label: string, cls = ''): HTMLElement => h('div', { class: `ao-room-stat ${cls}`.trim() }, h('strong', null, String(value)), h('span', null, label));
    this.stats.replaceChildren(stat(agents.length, t('topbar.counter.agents', { n: agents.length })), stat(working, t('topbar.counter.working', { n: working })), stat(needs, t('topbar.counter.needsYou', { n: needs }), needs > 0 ? 'is-attention' : ''));
  }

  private renderAccounts(agents: Agent[]): void {
    const ids = [...new Set(agents.map((a) => a.accountId))];
    const signature = ids.join(',');
    if (signature === this.signatures.accounts) return;
    this.signatures.accounts = signature;
    this.accounts.hidden = ids.length === 0;
    this.accounts.replaceChildren(sectionTitle(t('room.accounts')), h('div', { class: 'ao-chip-row' }, ...ids.map((id) => accountChip(this.ctx.account(id), true))));
  }

  private renderAgents(agents: Agent[]): void {
    const signature = agents.map((a) => `${a.id}${a.status}${a.shells.length}${a.activity?.id ?? ''}`).join('|');
    if (signature === this.signatures.agents) return;
    this.signatures.agents = signature;
    this.agents.replaceChildren(
      sectionTitle(t('room.agents'), h('span', { class: 'ao-section-count' }, String(agents.length))),
      agents.length === 0
        ? emptyNote(t('room.noAgents'))
        : h(
            'div',
            { class: 'ao-mini-list' },
            ...agents.map((agent) => {
              const avatar = createAvatar(26);
              avatar.update(agent, this.ctx.world.portrait(agent.id, 52));
              const ds = displayStatus(agent);
              const dot = statusDot(ds);
              setStatusDot(dot, ds);
              return h(
                'button',
                { type: 'button', class: 'ao-mini-row', onclick: () => this.ctx.selectAgent(agent.id, { focus: true }) },
                h('span', { class: 'ao-row-avatar' }, avatar.el, dot),
                h('span', { class: 'ao-mini-body' }, h('strong', null, agent.name), h('span', null, agent.kind === 'sub' ? t('agent.sub', { role: agentRole(agent) }) : t('agent.main'))),
                h('span', { class: `ao-mini-meta ao-text--${ds}` }, agent.activity ? activityText(agent.activity) : statusLabel(ds)),
              );
            }),
          ),
    );
  }

  private renderTeam(roomName: string, agents: Agent[]): void {
    const blockedReason = !this.ctx.isLocal ? localOnlyHint() : agents.length === 0 ? t('room.team.nobody') : null;
    const ids = agents.map((a) => a.id);
    this.composer.setTarget({
      key: `room:${this.roomId}`,
      agentIds: ids,
      teamLabel: roomName,
      placeholder: t('room.team.placeholder', { n: ids.length, room: roomName }),
      sendLabel: t('room.team.send'),
      blockedReason,
    });
    this.history.setAgents(this.ctx.snapshot ? this.ctx.snapshot.agents.filter((a) => a.projectId === this.roomId).map((a) => a.id) : ids);
    this.composer.render();
    this.history.render();
  }

  private renderTasks(agents: Agent[]): void {
    const withTasks = agents.filter((a) => a.tasks.length > 0);
    const signature = withTasks.map((a) => `${a.id}${a.tasks.map((task) => task.status[0]).join('')}`).join('|');
    if (signature === this.signatures.tasks) return;
    this.signatures.tasks = signature;
    this.tasks.replaceChildren(
      sectionTitle(t('tab.summary.tasks')),
      withTasks.length === 0
        ? emptyNote(t('room.noTasks'))
        : h(
            'div',
            null,
            ...withTasks.map((agent) => {
              const done = agent.tasks.filter((task) => task.status === 'completed').length;
              return h(
                'div',
                { class: 'ao-task-group' },
                h('div', { class: 'ao-task-group-head' }, h('strong', null, agent.name), h('span', { class: 'ao-section-count' }, `${done}/${agent.tasks.length}`)),
                h(
                  'ul',
                  { class: 'ao-tasks' },
                  ...agent.tasks.map((task) =>
                    h('li', { class: `ao-task is-${task.status}` }, h('span', { class: 'ao-task-mark', 'aria-hidden': 'true' }, task.status === 'completed' ? icon('check', 12) : null), h('span', { class: 'ao-task-text' }, taskLabel(task))),
                  ),
                ),
              );
            }),
          ),
    );
  }

  private renderActivity(agents: Agent[]): void {
    const items = roomActivities(agents, 12);
    const signature = items.map((i) => i.activity.id).join('|');
    if (signature === this.signatures.activity) return;
    this.signatures.activity = signature;
    this.activity.replaceChildren(
      sectionTitle(t('room.recent')),
      items.length === 0
        ? emptyNote(t('room.noRecent'))
        : h(
            'ol',
            { class: 'ao-timeline' },
            ...items.map(({ agent, activity }) =>
              h(
                'li',
                { class: `ao-tl-item ${activity.error ? 'is-error' : ''}`.trim() },
                h('span', { class: 'ao-tl-time' }, formatClock(activity.at)),
                h('span', { class: 'ao-tl-icon', 'aria-hidden': 'true' }, activity.icon),
                h('div', { class: 'ao-tl-body' }, h('span', { class: 'ao-tl-text' }, `${agent.name}: ${activityText(activity)}`)),
              ),
            ),
          ),
    );
  }
}
