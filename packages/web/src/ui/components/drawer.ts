// Right drawer: slides in when something is selected and shows the agent or the room view.
import type { AppContext, Component } from '../context';
import { isTeamId } from '@ai-office/shared';
import { h, toggleClass } from '../dom';
import { AgentView } from './agent-view';
import { RoomView } from './room-view';
import { TeamRemoteView } from './team-remote-view';

export class Drawer implements Component {
  readonly el = h('aside', { class: 'ao-drawer', 'aria-labelledby': 'ao-drawer-title', role: 'complementary' });
  private readonly agentView: AgentView;
  private readonly roomView: RoomView;
  private readonly remoteView: TeamRemoteView;
  private shown: 'agent' | 'room' | 'remote' | null = null;

  constructor(private readonly ctx: AppContext) {
    this.agentView = new AgentView(ctx);
    this.roomView = new RoomView(ctx);
    this.remoteView = new TeamRemoteView(ctx);
    this.el.append(this.agentView.el, this.roomView.el, this.remoteView.el);
    this.el.setAttribute('inert', '');
  }

  /** The shell is being rebuilt: stop the polling of the open agent or room view. */
  dispose(): void {
    this.agentView.deactivate();
    this.roomView.deactivate();
    this.shown = null;
  }

  render(): void {
    const selection = this.ctx.ui.get().selection;
    const open = selection !== null;
    toggleClass(this.el, 'is-open', open);
    this.el.setAttribute('aria-hidden', String(!open));
    if (open) this.el.removeAttribute('inert');
    else this.el.setAttribute('inert', '');

    // Somebody else's agent or room (team mode) gets its own read-only view.
    const kind = selection ? (isTeamId(selection.id) ? 'remote' : selection.type) : null;
    if (kind !== this.shown) {
      if (this.shown === 'agent') this.agentView.deactivate();
      if (this.shown === 'room') this.roomView.deactivate();
      this.shown = kind;
    }
    this.agentView.el.hidden = kind !== 'agent';
    this.roomView.el.hidden = kind !== 'room';
    this.remoteView.el.hidden = kind !== 'remote';
    if (selection !== null && kind === 'remote') {
      this.remoteView.setSelection(selection);
      this.remoteView.render();
    } else if (selection?.type === 'agent') {
      this.agentView.setAgent(selection.id);
      this.agentView.render();
    } else if (selection?.type === 'room') {
      this.roomView.setRoom(selection.id);
      this.roomView.render();
    }
  }
}
