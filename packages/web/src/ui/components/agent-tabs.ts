// Tab panels of the agent drawer: Resumo, Mensagens, Atividade, Dados.
import type { Activity, Agent } from '@ai-office/shared';
import { t } from '../../i18n';
import { describeError } from '../../net/backend';
import { FOCUS_TASK_MS } from '../board-store';
import { localOnlyHint, type AppContext } from '../context';
import { accountLabel, activityDetail, activityText, agentRole, shellLabel, taskLabel } from '../display';
import { compact, h, setText, toggleClass } from '../dom';
import {
  formatClockSeconds,
  formatCost,
  formatDayLabel,
  formatClock,
  formatDuration,
  formatTokens,
  percent,
} from '../format';
import { icon } from '../icons';
import { messageBlockedBySource } from '../model/source';
import { displayStatus, isLive, statusLabel } from '../model/status';
import { mergeTimeline } from '../model/timeline';
import { createAvatar, emptyNote, liveText, sectionTitle, setLive, setStatusDot, statusDot } from '../widgets';
import { MessageComposer } from './message-composer';
import { MessageHistory } from './message-history';

export interface AgentTab {
  readonly el: HTMLElement;
  update(agent: Agent): void;
  setActive?(active: boolean): void;
}

// --- Resumo ----------------------------------------------------------------------------------------------------------

interface Tile {
  el: HTMLElement;
  value: HTMLElement;
  sub: HTMLElement;
}

function tile(label: string): Tile {
  const value = h('div', { class: 'ao-tile-value' }, '—');
  const sub = h('div', { class: 'ao-tile-sub' });
  return { el: h('div', { class: 'ao-tile' }, h('div', { class: 'ao-tile-label' }, label), value, sub), value, sub };
}

export class SummaryTab implements AgentTab {
  readonly el = h('div', { class: 'ao-tab-body' });
  private readonly tools = tile(t('tab.summary.tools'));
  private readonly tokens = tile(t('tab.summary.tokens'));
  private readonly time = tile(t('tab.summary.time'));
  private readonly timeLive = liveText('duration', 0);
  private readonly cost = tile(t('tab.summary.cost'));
  private readonly now = h('div', { class: 'ao-block ao-now' });
  private readonly tasks = h('div', { class: 'ao-block' });
  private readonly relations = h('div', { class: 'ao-block' });
  private signatures = { now: '', tasks: '', relations: '' };

  constructor(private readonly ctx: AppContext) {
    this.time.value.replaceChildren(this.timeLive);
    this.el.append(
      h('div', { class: 'ao-tiles' }, this.tools.el, this.tokens.el, this.time.el, this.cost.el),
      this.now,
      this.tasks,
      this.relations,
    );
  }

  update(agent: Agent): void {
    const { stats } = agent;
    setText(this.tools.value, String(stats.toolCalls));
    setText(
      this.tools.sub,
      stats.linesAdded || stats.linesRemoved
        ? t('tab.summary.lines', { added: stats.linesAdded, removed: stats.linesRemoved })
        : t('tab.summary.calls'),
    );
    setText(this.tokens.value, formatTokens(stats.tokensIn + stats.tokensOut));
    setText(this.tokens.sub, `↓ ${formatTokens(stats.tokensIn)} · ↑ ${formatTokens(stats.tokensOut)}`);
    setLive(this.timeLive, 'duration', agent.startedAt);
    setText(this.cost.value, formatCost(stats.costUSD));
    setText(this.cost.sub, stats.costUSD === undefined ? t('tab.summary.unknownModel') : t('tab.summary.estimated'));
    this.renderNow(agent);
    this.renderTasks(agent);
    this.renderRelations(agent);
  }

  private renderNow(agent: Agent): void {
    const a = agent.activity;
    const signature = `${agent.status}|${a?.id ?? ''}|${agent.waitingFor ?? ''}`;
    if (signature === this.signatures.now) return;
    this.signatures.now = signature;
    this.now.replaceChildren(
      sectionTitle(t('tab.summary.now')),
      a
        ? h(
            'div',
            { class: `ao-now-card ${a.error ? 'is-error' : ''}`.trim() },
            h('span', { class: 'ao-now-icon', 'aria-hidden': 'true' }, a.icon),
            h(
              'div',
              { class: 'ao-now-text' },
              h('strong', null, activityText(a)),
              activityDetail(a) ? h('code', null, activityDetail(a)) : null,
              liveText('ago', a.at, 'ao-now-time'),
            ),
          )
        : emptyNote(isLive(agent) ? t('tab.summary.noActivity') : t('tab.summary.offlineNoActivity')),
    );
  }

  private renderTasks(agent: Agent): void {
    const focused = this.focusedTaskId(agent);
    const signature = `${focused ?? ''}#${agent.tasks.map((task) => `${task.id}${task.status}${task.title}`).join('|')}`;
    if (signature === this.signatures.tasks) return;
    this.signatures.tasks = signature;
    const done = agent.tasks.filter((task) => task.status === 'completed').length;
    this.tasks.replaceChildren(
      sectionTitle(
        t('tab.summary.tasks'),
        agent.tasks.length ? h('span', { class: 'ao-section-count' }, `${done}/${agent.tasks.length}`) : null,
      ),
      agent.tasks.length === 0
        ? emptyNote(t('tab.summary.noTasks'))
        : h(
            'div',
            null,
            h(
              'div',
              {
                class: 'ao-progress ao-progress--wide',
                role: 'progressbar',
                'aria-valuemin': 0,
                'aria-valuemax': agent.tasks.length,
                'aria-valuenow': done,
              },
              h('span', { class: 'ao-progress-bar', style: `width:${percent(done, agent.tasks.length)}%` }),
            ),
            h(
              'ul',
              { class: 'ao-tasks' },
              ...agent.tasks.map((task) =>
                h(
                  'li',
                  {
                    class: `ao-task is-${task.status}${task.id === focused ? ' is-focus' : ''}`,
                    'data-task-id': task.id,
                  },
                  h(
                    'span',
                    { class: 'ao-task-mark', 'aria-hidden': 'true' },
                    task.status === 'completed' ? icon('check', 12) : null,
                  ),
                  h('span', { class: 'ao-task-text' }, taskLabel(task)),
                  h(
                    'span',
                    { class: 'ao-visually-hidden' },
                    ` (${task.status === 'completed' ? t('task.completed') : task.status === 'in_progress' ? t('task.inProgress') : t('task.pending')})`,
                  ),
                ),
              ),
            ),
          ),
    );
    if (focused !== null) this.tasks.querySelector('.is-focus')?.scrollIntoView({ block: 'nearest' });
  }

  /** The task picked on the task board, while its highlight lasts. */
  private focusedTaskId(agent: Agent): string | null {
    const focus = this.ctx.board.get().focusTask;
    return focus && focus.agentId === agent.id && this.ctx.now() - focus.at < FOCUS_TASK_MS ? focus.taskId : null;
  }

  private renderRelations(agent: Agent): void {
    const snapshot = this.ctx.snapshot;
    const related =
      agent.kind === 'main'
        ? (snapshot?.agents ?? []).filter((a) => a.parentId === agent.id && isLive(a))
        : (snapshot?.agents ?? []).filter((a) => a.id === agent.parentId);
    const signature = `${agent.kind}|${related.map((a) => `${a.id}${a.status}${a.activity?.id ?? ''}${a.name}`).join('|')}`;
    if (signature === this.signatures.relations) return;
    this.signatures.relations = signature;
    const title = agent.kind === 'main' ? t('tab.summary.subagents') : t('tab.summary.owner');
    this.relations.replaceChildren(
      sectionTitle(
        title,
        agent.kind === 'main' && related.length
          ? h('span', { class: 'ao-section-count' }, String(related.length))
          : null,
      ),
      related.length === 0
        ? emptyNote(agent.kind === 'main' ? t('tab.summary.noSubagents') : t('tab.summary.ownerGone'))
        : h('div', { class: 'ao-mini-list' }, ...related.map((other) => this.miniRow(other))),
    );
  }

  private miniRow(agent: Agent): HTMLElement {
    const avatar = createAvatar(26);
    avatar.update(agent, this.ctx.world.portrait(agent.id, 52));
    const dot = statusDot(displayStatus(agent));
    setStatusDot(dot, displayStatus(agent));
    return h(
      'button',
      { type: 'button', class: 'ao-mini-row', onclick: () => this.ctx.selectAgent(agent.id, { focus: true }) },
      h('span', { class: 'ao-row-avatar' }, avatar.el, dot),
      h(
        'span',
        { class: 'ao-mini-body' },
        h('strong', null, agent.name),
        h(
          'span',
          null,
          agent.kind === 'sub'
            ? agentRole(agent)
            : agent.activity
              ? activityText(agent.activity)
              : statusLabel(displayStatus(agent)),
        ),
      ),
      h(
        'span',
        { class: 'ao-mini-meta' },
        agent.activity ? activityText(agent.activity) : statusLabel(displayStatus(agent)),
      ),
    );
  }
}

// --- Mensagens -------------------------------------------------------------------------------------------------------

export class MessagesTab implements AgentTab {
  readonly el = h('div', { class: 'ao-tab-body' });
  private readonly composer: MessageComposer;
  private readonly history: MessageHistory;

  constructor(private readonly ctx: AppContext) {
    this.history = new MessageHistory(ctx, (id) => ctx.agent(id)?.name ?? t('agent.fallback'));
    this.composer = new MessageComposer(ctx, () => this.history.refreshNow());
    this.el.append(
      sectionTitle(t('tab.messages.send')),
      this.composer.el,
      sectionTitle(t('tab.messages.history')),
      this.history.el,
    );
  }

  update(agent: Agent): void {
    const blockedReason = !this.ctx.isLocal
      ? localOnlyHint()
      : (messageBlockedBySource(agent) ?? (!isLive(agent) ? t('agent.gone') : null));
    this.composer.setTarget({
      key: agent.id,
      agentIds: [agent.id],
      placeholder: t('tab.messages.placeholder', { name: agent.name }),
      sendLabel: t('common.send'),
      blockedReason,
    });
    this.history.setAgents([agent.id]);
    this.composer.render();
    this.history.render();
  }

  setActive(active: boolean): void {
    this.history.setActive(active && this.ctx.isLocal);
  }
}

// --- Atividade -------------------------------------------------------------------------------------------------------

const TIMELINE_PAGE = 60;

export class ActivityTab implements AgentTab {
  readonly el = h('div', { class: 'ao-tab-body' });
  private readonly shells = h('div', { class: 'ao-block' });
  private readonly timeline = h('div', { class: 'ao-block' });
  private readonly history = new Map<string, Activity[]>();
  private loading = new Set<string>();
  private failed = new Map<string, string>();
  private agentId = '';
  private visibleCount = TIMELINE_PAGE;
  private signature = '';
  private shellSignature = '';
  private active = false;
  private readonly expanded = new Set<string>();

  constructor(private readonly ctx: AppContext) {
    this.el.append(this.shells, this.timeline);
  }

  setActive(active: boolean): void {
    if (active && !this.active && this.agentId) void this.load(this.agentId);
    this.active = active;
  }

  update(agent: Agent): void {
    if (agent.id !== this.agentId) {
      this.agentId = agent.id;
      this.visibleCount = TIMELINE_PAGE;
      this.expanded.clear();
      this.signature = '';
      if (this.active) void this.load(agent.id);
    }
    this.renderShells(agent);
    this.renderTimeline(agent);
  }

  private async load(agentId: string): Promise<void> {
    if (this.loading.has(agentId)) return;
    this.loading.add(agentId);
    this.failed.delete(agentId);
    this.signature = '';
    try {
      this.history.set(agentId, await this.ctx.store.backend.history(agentId));
    } catch (error) {
      this.failed.set(agentId, describeError(error));
    } finally {
      this.loading.delete(agentId);
      this.signature = '';
      this.ctx.refresh();
    }
  }

  private renderShells(agent: Agent): void {
    const signature = agent.shells.map((s) => `${s.id}${s.label}`).join('|');
    if (signature === this.shellSignature) return;
    this.shellSignature = signature;
    this.shells.replaceChildren(
      sectionTitle(
        t('tab.activity.shells'),
        agent.shells.length ? h('span', { class: 'ao-section-count' }, String(agent.shells.length)) : null,
      ),
      agent.shells.length === 0
        ? emptyNote(t('tab.activity.noShells'))
        : h(
            'ul',
            { class: 'ao-shell-rows' },
            ...agent.shells.map((shell) =>
              h(
                'li',
                { class: 'ao-shell-row' },
                icon('terminal', 14),
                h(
                  'span',
                  { class: 'ao-shell-row-body' },
                  h('strong', null, shellLabel(shell)),
                  shell.command ? h('code', null, shell.command) : null,
                ),
                h(
                  'span',
                  { class: 'ao-shell-kind' },
                  shell.kind === 'monitor'
                    ? t('shell.kind.monitor')
                    : shell.background
                      ? t('shell.kind.background')
                      : t('shell.row.foreground'),
                ),
                liveText('elapsed', shell.startedAt, 'ao-shell-elapsed'),
              ),
            ),
          ),
    );
  }

  private renderTimeline(agent: Agent): void {
    const items = mergeTimeline(agent.recent, this.history.get(agent.id) ?? []);
    const loading = this.loading.has(agent.id);
    const error = this.failed.get(agent.id);
    const signature = `${items.length}|${items[0]?.id ?? ''}|${loading}|${error ?? ''}|${this.visibleCount}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const shown = items.slice(0, this.visibleCount);
    this.timeline.replaceChildren(
      ...compact(
        sectionTitle(
          t('tab.activity.timeline'),
          loading ? h('span', { class: 'ao-section-count' }, t('tab.activity.loadingShort')) : null,
        ),
        error ? h('p', { class: 'ao-error' }, error) : null,
        items.length === 0
          ? emptyNote(loading ? t('tab.activity.loading') : t('tab.summary.noActivity'))
          : h('ol', { class: 'ao-timeline' }, ...shown.map((a) => this.timelineItem(a))),
        items.length > shown.length
          ? h(
              'button',
              { type: 'button', class: 'ao-btn ao-btn--ghost ao-more', onclick: () => this.showMore() },
              t('common.showMore', { n: items.length - shown.length }),
            )
          : null,
      ),
    );
  }

  private showMore(): void {
    this.visibleCount += TIMELINE_PAGE;
    this.signature = '';
    this.ctx.refresh();
  }

  private timelineItem(activity: Activity): HTMLElement {
    const open = this.expanded.has(activity.id);
    const detail = activityDetail(activity);
    const item = h(
      'li',
      { class: `ao-tl-item ${activity.error ? 'is-error' : ''} ${open ? 'is-open' : ''}`.trim() },
      h('span', { class: 'ao-tl-time' }, formatClockSeconds(activity.at)),
      h('span', { class: 'ao-tl-icon', 'aria-hidden': 'true' }, activity.icon),
      h(
        'div',
        { class: 'ao-tl-body' },
        h('span', { class: 'ao-tl-text' }, activityText(activity)),
        activity.durationMs && activity.durationMs >= 1000
          ? h('span', { class: 'ao-tl-duration' }, formatDuration(activity.durationMs))
          : null,
        detail ? h('code', { class: 'ao-tl-detail' }, detail) : null,
      ),
    );
    if (detail) {
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-expanded', String(open));
      const toggle = (): void => {
        if (this.expanded.has(activity.id)) this.expanded.delete(activity.id);
        else this.expanded.add(activity.id);
        toggleClass(item, 'is-open', this.expanded.has(activity.id));
        item.setAttribute('aria-expanded', String(this.expanded.has(activity.id)));
      };
      item.addEventListener('click', toggle);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      });
    }
    return item;
  }
}

// --- Dados -----------------------------------------------------------------------------------------------------------

interface DataRow {
  el: HTMLElement;
  value: HTMLElement;
}

export class DataTab implements AgentTab {
  readonly el = h('div', { class: 'ao-tab-body' });
  private readonly list = h('dl', { class: 'ao-data' });
  private readonly rows = new Map<string, DataRow>();
  private readonly duration = liveText('duration', 0);
  private readonly accountCell = h('span', { class: 'ao-data-account' });
  private readonly sessionId = h('code', { class: 'ao-data-code' });
  private agent: Agent | null = null;

  constructor(private readonly ctx: AppContext) {
    this.el.append(this.list);
    this.add('account', t('data.account'));
    this.add('room', t('data.room'));
    this.add('kind', t('data.kind'));
    this.add('model', t('data.model'));
    this.add('branch', t('data.branch'));
    this.add('permissionMode', t('data.permissionMode'));
    this.add('session', t('data.session'));
    this.add('started', t('data.started'));
    this.add('duration', t('data.duration'));
    this.add('tools', t('tab.summary.tools'));
    this.add('tokensIn', t('data.tokensIn'));
    this.add('tokensOut', t('data.tokensOut'));
    this.add('lines', t('data.lines'));
    this.add('subagents', t('data.subagents'));
    this.add('cost', t('data.cost'));
    this.row('account').value.replaceChildren(this.accountCell);
    this.row('duration').value.replaceChildren(this.duration);
    const copy = h(
      'button',
      {
        type: 'button',
        class: 'ao-iconbtn ao-iconbtn--small',
        'aria-label': t('data.copySession'),
        title: t('data.copySession'),
        onclick: () => this.agent && ctx.copy(this.agent.sessionId, t('data.copied')),
      },
      icon('copy', 14),
    );
    this.row('session').value.replaceChildren(this.sessionId, copy);
  }

  private add(key: string, label: string): void {
    const value = h('dd', { class: 'ao-data-value' });
    const el = h('div', { class: 'ao-data-row' }, h('dt', null, label), value);
    this.rows.set(key, { el, value });
    this.list.appendChild(el);
  }

  private row(key: string): DataRow {
    const row = this.rows.get(key);
    if (!row) throw new Error(`Unknown data row: ${key}`);
    return row;
  }

  private setValue(key: string, text: string | undefined): void {
    const row = this.row(key);
    row.el.hidden = text === undefined || text === '';
    if (text !== undefined) setText(row.value, text);
  }

  update(agent: Agent): void {
    this.agent = agent;
    const account = this.ctx.account(agent.accountId);
    const project = this.ctx.project(agent.projectId);
    this.accountCell.replaceChildren(
      h('span', { class: 'ao-dot-account', style: `background:${account?.color ?? '#8d99ad'}` }),
      account ? accountLabel(account) : agent.accountId,
    );
    this.setValue('room', project?.name);
    this.setValue('kind', agent.kind === 'main' ? t('agent.main') : t('agent.sub', { role: agentRole(agent) }));
    this.setValue('model', agent.model);
    this.setValue('branch', agent.gitBranch);
    this.setValue('permissionMode', agent.permissionMode);
    setText(this.sessionId, agent.sessionId);
    this.setValue('started', `${formatDayLabel(agent.startedAt, this.ctx.now())}, ${formatClock(agent.startedAt)}`);
    setLive(this.duration, 'duration', agent.startedAt);
    const s = agent.stats;
    this.setValue('tools', String(s.toolCalls));
    this.setValue('tokensIn', formatTokens(s.tokensIn));
    this.setValue('tokensOut', formatTokens(s.tokensOut));
    this.setValue('lines', `+${s.linesAdded} / −${s.linesRemoved}`);
    this.setValue('subagents', String(s.subagents));
    this.setValue('cost', formatCost(s.costUSD));
  }
}
