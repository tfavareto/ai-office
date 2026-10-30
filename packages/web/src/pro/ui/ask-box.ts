// What a terminal's agent waits for, printed under its conversation like the CLI's prompt (amber box): the permission
// it asks for, with Allow / Always allow / Deny right there, or the question it asks (answered in the session's own
// terminal). Answers go through `AppContext.answerPermission`, the same client and endpoint as the inbox. While one is
// on its way the buttons are inert (`aria-disabled`, so the keyboard focus stays on them); "already answered" and
// errors are said in the box; a request answered elsewhere disappears with the next snapshot.
import type { Agent, PermissionDecision, PermissionRequest } from '@ai-office/shared';
import { t } from '../../i18n';
import type { PermissionOutcome } from '../../ui/context';
import { agentWaitingFor, permissionSuggestion, permissionSummary } from '../../ui/display';
import { h, setAttr, setText, toggleClass } from '../../ui/dom';
import {
  ASK_NONE,
  askView,
  canSend,
  followRequest,
  sending,
  settled,
  terminalRequest,
  type AskAction,
  type AskNote,
  type AskState,
  type AskView,
} from '../model/ask';

export interface AskHost {
  /** The agent as the office knows it now (the request may have changed since the box was drawn). */
  currentAgent(): Agent | undefined;
  answer(agent: Agent, decision: PermissionDecision): Promise<PermissionOutcome>;
  isLocal(): boolean;
  now(): number;
}

const DECISIONS: Readonly<Record<AskAction, PermissionDecision>> = {
  allow: { behavior: 'allow' },
  always: { behavior: 'allow', suggestion: 0 },
  deny: { behavior: 'deny' },
};

function noteText(note: AskNote): string {
  switch (note.kind) {
    case 'none':
      return '';
    case 'sending':
      return t('permission.sending');
    case 'sent':
      return t('permission.sent');
    case 'answered':
      return t('toast.alreadyAnswered');
    case 'failed':
      return t('pro.ask.failed', { error: note.error });
    case 'expired':
      return t('pro.ask.expired');
    case 'local-only':
      return t('permission.localOnly');
  }
}

export class AskBox {
  readonly el = h('div', { class: 'ao-cli-ask' });
  private readonly title = h('div', { class: 'ao-cli-ask-title' });
  private readonly detail = h('div', { class: 'ao-cli-ask-detail' });
  private readonly hint = h('div', { class: 'ao-cli-ask-hint' });
  private readonly actions = h('div', { class: 'ao-cli-ask-actions', role: 'group' });
  private readonly note = h('div', { class: 'ao-cli-ask-note', role: 'status' });
  private readonly buttons: Readonly<Record<AskAction, HTMLButtonElement>>;
  private state: AskState = ASK_NONE;
  private permission: PermissionRequest | null = null;
  private agent: Agent | null = null;
  private signature = '';

  constructor(private readonly host: AskHost) {
    this.buttons = {
      allow: this.button('allow', 'pro.ask.allow'),
      always: this.button('always', 'pro.ask.always'),
      deny: this.button('deny', 'pro.ask.deny'),
    };
    setAttr(this.actions, 'aria-label', t('pro.ask.actions'));
    this.actions.append(this.buttons.allow, this.buttons.always, this.buttons.deny);
    this.el.append(this.title, this.detail, this.hint, this.actions, this.note);
  }

  private button(action: AskAction, key: 'pro.ask.allow' | 'pro.ask.always' | 'pro.ask.deny'): HTMLButtonElement {
    const button = h(
      'button',
      { type: 'button', class: `ao-cli-ask-btn is-${action}`, 'data-no-drag': '' },
      h('span', { class: 'ao-cli-ask-btn-text' }, t(key)),
    );
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.decide(action);
    });
    return button;
  }

  /**
   * Draws what the agent waits for; returns false when it waits for nothing (the box is then left out). `finished`
   * is a faded subagent: it answers nothing.
   */
  update(agent: Agent, waiting: boolean, finished: boolean): boolean {
    const permission = waiting ? terminalRequest(agent, finished) : null;
    this.state = followRequest(this.state, permission?.id ?? null);
    this.permission = permission;
    this.agent = agent;
    if (!waiting) {
      this.signature = '';
      return false;
    }
    this.render();
    return true;
  }

  private render(): void {
    const permission = this.permission;
    const agent = this.agent;
    const view = permission === null ? null : askView(permission, this.state, this.context());
    const title = permission ? t('pro.term.permission', { tool: permission.toolName }) : t('pro.term.question');
    const detail = permission
      ? permissionSummary(permission)
      : ((agent === null ? undefined : agentWaitingFor(agent)) ?? t('sidebar.row.needsYou'));
    const signature = JSON.stringify([title, detail, view, agent?.name]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.title.replaceChildren(h('span', { 'aria-hidden': 'true' }, '◆ '), title);
    setText(this.detail, detail);
    setText(this.hint, t(permission ? 'pro.term.permission.hint' : 'pro.term.question.hint'));
    this.renderActions(permission, view);
  }

  private context(): { local: boolean; now: number } {
    return { local: this.host.isLocal(), now: this.host.now() };
  }

  private renderActions(permission: PermissionRequest | null, view: AskView | null): void {
    this.actions.hidden = view === null || !view.showButtons;
    const note = view === null ? '' : noteText(view.note);
    setText(this.note, note);
    this.note.hidden = note === '';
    toggleClass(this.note, 'is-error', view?.note.kind === 'failed');
    if (permission === null || view === null) return;
    const params = { tool: permission.toolName, name: this.agent?.name ?? '' };
    this.buttons.always.hidden = !view.always;
    const labels: Readonly<Record<AskAction, string>> = {
      allow: t('pro.ask.allow.label', params),
      always: t('pro.ask.always.label', { ...params, rule: view.always ? permissionSuggestion(permission, 0) : '' }),
      deny: t('pro.ask.deny.label', params),
    };
    for (const action of ['allow', 'always', 'deny'] as const) {
      const button = this.buttons[action];
      setAttr(button, 'aria-label', labels[action]);
      setAttr(button, 'title', labels[action]);
      setAttr(button, 'aria-disabled', view.enabled ? null : 'true');
      toggleClass(button, 'is-pressed', view.pressed === action);
    }
  }

  private async decide(action: AskAction): Promise<void> {
    const agent = this.host.currentAgent();
    const requestId = this.state.requestId;
    const permission = this.permission;
    if (agent === undefined || requestId === null || permission === null) return;
    if (!askView(permission, this.state, this.context()).enabled || !canSend(this.state, agent)) return;
    this.state = sending(this.state, action);
    this.render();
    const outcome = await this.host.answer(agent, DECISIONS[action]);
    this.state = settled(this.state, requestId, outcome);
    this.render();
  }
}
