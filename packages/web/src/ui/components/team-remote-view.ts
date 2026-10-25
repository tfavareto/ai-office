// Drawer content for somebody else's agent or room (team mode). Read-only by construction: it has no message box, no
// terminal, no permission card and no hire button, and it shows only what the member chose to share.
import { isCodex, type Agent, type Project } from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext, Component } from '../context';
import { activityText, agentRole } from '../display';
import { h } from '../dom';
import { formatCost, formatTokens } from '../format';
import { personIdOf } from '../model/team';
import { displayStatus } from '../model/status';
import { remoteStatusLabel } from '../model/team-text';
import { createAvatar, emptyNote, liveText, sectionTitle, setLive, setStatusDot, statusDot } from '../widgets';
import { closeButton } from './overlay';

export class TeamRemoteView implements Component {
  readonly el = h('div', { class: 'ao-teamview' });
  private readonly hero = h('header', { class: 'ao-hero ao-team-hero' });
  private readonly body = h('div', { class: 'ao-agent-body' });
  private readonly gone = h('div', { class: 'ao-gone', hidden: true }, emptyNote(t('team.remote.gone')));
  private selection: { type: 'agent' | 'room'; id: string } | null = null;
  private signature = '';

  constructor(private readonly ctx: AppContext) {
    this.el.append(this.hero, this.body, this.gone);
  }

  setSelection(selection: { type: 'agent' | 'room'; id: string }): void {
    if (this.selection?.id === selection.id && this.selection.type === selection.type) return;
    this.selection = selection;
    this.signature = '';
  }

  render(): void {
    const selection = this.selection;
    if (selection === null) return;
    const agent = selection.type === 'agent' ? this.ctx.agent(selection.id) : undefined;
    const project = this.ctx.project(selection.type === 'agent' ? (agent?.projectId ?? '') : selection.id);
    const found = selection.type === 'agent' ? agent !== undefined && project !== undefined : project !== undefined;
    this.body.hidden = !found;
    this.gone.hidden = found;
    this.hero.hidden = !found;
    if (!found || project === undefined) return;
    const members = this.ctx.teamOverlay.agents.filter((candidate) => candidate.projectId === project.id);
    const signature = [
      selection.id,
      project.name,
      ...members.map((m) => `${m.id}|${m.status}|${m.activity?.text}|${m.title}|${m.gitBranch}|${m.stats.tokensIn}`),
    ].join('~');
    if (signature === this.signature) return;
    this.signature = signature;
    if (agent !== undefined) this.renderAgent(agent, project);
    else this.renderRoom(project, members);
  }

  private memberName(project: Project): string {
    const personId = personIdOf(project.id);
    return this.ctx.teamOverlay.accounts.find((account) => account.id === `team:${personId}`)?.label ?? '';
  }

  private deviceOf(project: Project): string {
    const personId = personIdOf(project.id);
    return this.ctx.liveSnapshot?.team?.people.find((person) => person.id === personId)?.device ?? '';
  }

  private head(avatarAgent: Agent | undefined, title: string, project: Project): void {
    const color = project.theme?.color ?? '#8d99ad';
    this.hero.style.setProperty('--member', color);
    const avatar = avatarAgent === undefined ? null : createAvatar(56);
    if (avatar !== null && avatarAgent !== undefined)
      avatar.update(avatarAgent, this.ctx.world.portrait(avatarAgent.id, 112));
    const device = this.deviceOf(project);
    this.hero.replaceChildren(
      avatar === null
        ? h('span', { class: 'ao-room-hero-swatch', style: `background:${color}`, 'aria-hidden': 'true' })
        : h('div', { class: 'ao-hero-avatar' }, avatar.el),
      h(
        'div',
        { class: 'ao-hero-info' },
        h('h2', { class: 'ao-hero-name', id: 'ao-drawer-title' }, title),
        h(
          'div',
          { class: 'ao-hero-tags' },
          h('span', { class: 'ao-tag ao-tag--member' }, this.memberName(project)),
          avatarAgent !== undefined && isCodex(avatarAgent)
            ? h('span', { class: 'ao-tag ao-tag--codex' }, t('codex.badge'))
            : null,
          device ? h('span', { class: 'ao-tag' }, t('team.person.device', { device })) : null,
        ),
      ),
      closeButton(t('drawer.close'), () => this.ctx.clearSelection()),
    );
  }

  private renderAgent(agent: Agent, project: Project): void {
    this.head(agent, agent.name, project);
    const ds = displayStatus(agent);
    const dot = statusDot(ds);
    setStatusDot(dot, ds);
    const since = liveText('ago', agent.statusSince, 'ao-status-since');
    setLive(since, 'ago', agent.statusSince);
    const rows: [string, string][] = [];
    if (agent.title !== undefined) rows.push([t('team.remote.title'), agent.title]);
    if (agent.gitBranch !== undefined) rows.push([t('team.remote.branch'), agent.gitBranch]);
    if (agent.stats.tokensIn > 0) rows.push([t('team.remote.tokens'), formatTokens(agent.stats.tokensIn)]);
    if (agent.stats.costUSD !== undefined) rows.push([t('team.remote.cost'), formatCost(agent.stats.costUSD)]);
    this.body.replaceChildren(
      h('p', { class: 'ao-note ao-team-readonly' }, t('team.remote.readonly', { member: this.memberName(project) })),
      h(
        'div',
        { class: 'ao-status-row' },
        h(
          'div',
          { class: 'ao-status-info' },
          dot,
          h('span', { class: 'ao-status-text' }, remoteStatusLabel(ds)),
          h('span', { class: 'ao-note' }, `${t('team.remote.since')} · `, since),
        ),
      ),
      h(
        'div',
        { class: 'ao-block' },
        sectionTitle(t('team.remote.doing')),
        h(
          'p',
          { class: 'ao-team-doing' },
          agent.activity ? `${agent.activity.icon} ${activityText(agent.activity)}` : '—',
        ),
        agent.kind === 'sub' ? h('p', { class: 'ao-note' }, agentRole(agent)) : null,
      ),
      h(
        'div',
        { class: 'ao-block' },
        sectionTitle(t('team.remote.details')),
        rows.length === 0
          ? emptyNote(t('team.remote.hidden'))
          : h(
              'dl',
              { class: 'ao-team-details' },
              ...rows.flatMap(([label, value]) => [h('dt', null, label), h('dd', null, value)]),
            ),
        rows.length === 0 ? null : h('p', { class: 'ao-note' }, t('team.remote.hidden')),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'ao-link ao-room-link',
          onclick: () => this.ctx.selectRoom(project.id, { focus: true }),
        },
        project.name,
      ),
    );
  }

  private renderRoom(project: Project, members: Agent[]): void {
    this.head(undefined, project.name, project);
    this.body.replaceChildren(
      h('p', { class: 'ao-note ao-team-readonly' }, t('team.remote.readonly', { member: this.memberName(project) })),
      h(
        'div',
        { class: 'ao-block' },
        sectionTitle(t('team.remote.agents'), h('span', { class: 'ao-section-count' }, String(members.length))),
        members.length === 0
          ? emptyNote(t('room.noAgents'))
          : h(
              'div',
              { class: 'ao-mini-list' },
              ...members.map((agent) => {
                const ds = displayStatus(agent);
                const dot = statusDot(ds);
                setStatusDot(dot, ds);
                const avatar = createAvatar(26);
                avatar.update(agent, this.ctx.world.portrait(agent.id, 52));
                return h(
                  'button',
                  {
                    type: 'button',
                    class: 'ao-mini-row',
                    onclick: () => this.ctx.selectAgent(agent.id, { focus: true }),
                  },
                  h('span', { class: 'ao-row-avatar' }, avatar.el, dot),
                  h(
                    'span',
                    { class: 'ao-mini-body' },
                    h('strong', null, agent.name),
                    h('span', null, remoteStatusLabel(ds)),
                  ),
                  h(
                    'span',
                    { class: `ao-mini-meta ao-text--${ds}` },
                    agent.activity ? activityText(agent.activity) : '',
                  ),
                );
              }),
            ),
      ),
    );
  }
}
