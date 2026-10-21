// Small tip that follows the pointer over the world: who/what is under the cursor.
import { t } from '../../i18n';
import type { HoverInfo } from '../../world/api';
import type { AppContext, Component } from '../context';
import { h, setText } from '../dom';
import { activityText, agentKindLabel, agentTitle } from '../display';
import { displayStatus, statusLabel } from '../model/status';
import { branchChip } from '../model/git';
import { agentsOfProject } from '../model/rooms';

const OFFSET_PX = 14;

export class HoverTip implements Component {
  readonly el = h('div', { class: 'ao-hovertip', role: 'tooltip', hidden: true });
  private readonly title = h('strong');
  private readonly line = h('span');
  private readonly extra = h('span', { class: 'ao-hovertip-extra' });
  private readonly branch = h('span', { class: 'ao-hovertip-extra', hidden: true });
  private hover: HoverInfo | null = null;

  constructor(private readonly ctx: AppContext) {
    this.el.append(this.title, this.line, this.branch, this.extra);
  }

  /** Called by the world on pointer movement; updates immediately, outside the main render pass. */
  setHover(hover: HoverInfo | null): void {
    this.hover = hover;
    this.render();
  }

  render(): void {
    const hover = this.hover;
    const agent = hover?.agentId ? this.ctx.agent(hover.agentId) : undefined;
    const project = hover?.roomId ? this.ctx.project(hover.roomId) : undefined;
    if (!hover || (!agent && !project)) {
      this.el.hidden = true;
      return;
    }
    this.branch.hidden = true;
    if (hover.desk && project) {
      setText(this.title, t('hover.desk.title'));
      setText(this.line, t('hover.desk.hint'));
      setText(this.extra, project.name);
    } else if (agent) {
      setText(this.title, agent.name);
      setText(this.line, `${agentKindLabel(agent)} · ${statusLabel(displayStatus(agent))}`);
      setText(this.extra, agent.activity ? `${agent.activity.icon} ${activityText(agent.activity)}` : (agentTitle(agent) ?? ''));
    } else if (project) {
      const agents = agentsOfProject(this.ctx.snapshot, project.id);
      setText(this.title, project.name);
      setText(this.line, t('hover.room.people', { n: agents.length }));
      setText(this.extra, project.path);
      const chip = this.ctx.prefs.get().showGit ? branchChip(project.git) : null;
      this.branch.hidden = chip === null;
      if (chip !== null) setText(this.branch, t('hover.room.branch', { branch: chip.label }));
    }
    this.el.hidden = false;
    const x = Math.min(hover.x + OFFSET_PX, window.innerWidth - 280);
    const y = Math.min(hover.y + OFFSET_PX, window.innerHeight - 100);
    this.el.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }
}
