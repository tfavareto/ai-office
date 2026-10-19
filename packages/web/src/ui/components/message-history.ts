// History of messages sent to one agent or a room (team messages are grouped: "2 de 3 entregues").
import type { AppContext, Component } from '../context';
import { h, setText } from '../dom';
import { formatClock } from '../format';
import { groupMessages, groupStatusLabel, type MessageGroupView } from '../model/messages';
import { emptyNote } from '../widgets';

let nextViewId = 0;

export class MessageHistory implements Component {
  readonly el = h('div', { class: 'ao-msg-history', 'aria-live': 'polite' });
  private readonly viewId = `history-${nextViewId++}`;
  private agentIds: readonly string[] = [];
  private signature = '';
  private watching = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly nameOf: (agentId: string) => string,
  ) {}

  /** Starts (or stops, with an empty list) watching the messages of these agents. */
  setAgents(agentIds: readonly string[]): void {
    if (agentIds.length === this.agentIds.length && agentIds.every((id, i) => id === this.agentIds[i])) return;
    this.agentIds = agentIds;
    this.signature = '';
    if (this.watching) this.ctx.messages.watch(this.viewId, agentIds);
  }

  /** Only poll while the history is on screen. */
  setActive(active: boolean): void {
    if (active === this.watching) return;
    this.watching = active;
    if (active) this.ctx.messages.watch(this.viewId, this.agentIds);
    else this.ctx.messages.unwatch(this.viewId);
  }

  refreshNow(): void {
    void this.ctx.messages.refresh(this.agentIds);
  }

  render(): void {
    const all = this.agentIds.flatMap((id) => this.ctx.messages.messagesOf(id));
    const groups = groupMessages(all);
    const signature = groups.map((g) => `${g.key}:${g.messages.map((m) => m.status + (m.via ?? '')).join('')}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    if (groups.length === 0) {
      this.el.replaceChildren(emptyNote('Nenhuma mensagem enviada ainda.'));
      return;
    }
    this.el.replaceChildren(...groups.map((group) => this.groupView(group)));
  }

  private groupView(group: MessageGroupView): HTMLElement {
    const pending = group.queued > 0;
    const status = h('span', { class: `ao-msg-status ${pending ? 'is-pending' : group.expired > 0 ? 'is-expired' : 'is-done'}` }, groupStatusLabel(group));
    const body = h('p', { class: 'ao-msg-text' });
    setText(body, group.text);
    const item = h('article', { class: 'ao-msg' }, h('div', { class: 'ao-msg-head' }, h('span', { class: 'ao-msg-time' }, formatClock(group.createdAt)), status), body);
    if (group.isTeam && group.total > 1) {
      item.append(
        h(
          'ul',
          { class: 'ao-msg-members' },
          ...group.messages.map((message) =>
            h('li', null, h('span', null, this.nameOf(message.agentId)), h('span', { class: `ao-msg-member-status is-${message.status}` }, groupStatusLabel({ ...group, messages: [message], isTeam: false }))),
          ),
        ),
      );
    }
    return item;
  }
}
