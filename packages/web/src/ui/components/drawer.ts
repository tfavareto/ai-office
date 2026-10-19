// Right drawer: slides in when something is selected and shows the agent or the room view.
import type { AppContext, Component } from '../context';
import { h, toggleClass } from '../dom';
import { AgentView } from './agent-view';
import { RoomView } from './room-view';

export class Drawer implements Component {
  readonly el = h('aside', { class: 'ao-drawer', 'aria-labelledby': 'ao-drawer-title', role: 'complementary' });
  private readonly agentView: AgentView;
  private readonly roomView: RoomView;
  private shown: 'agent' | 'room' | null = null;

  constructor(private readonly ctx: AppContext) {
    this.agentView = new AgentView(ctx);
    this.roomView = new RoomView(ctx);
    this.el.append(this.agentView.el, this.roomView.el);
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

    const kind = selection ? selection.type : null;
    if (kind !== this.shown) {
      if (this.shown === 'agent') this.agentView.deactivate();
      if (this.shown === 'room') this.roomView.deactivate();
      this.shown = kind;
    }
    this.agentView.el.hidden = kind !== 'agent';
    this.roomView.el.hidden = kind !== 'room';
    if (selection?.type === 'agent') {
      this.agentView.setAgent(selection.id);
      this.agentView.render();
    } else if (selection?.type === 'room') {
      this.roomView.setRoom(selection.id);
      this.roomView.render();
    }
  }
}
