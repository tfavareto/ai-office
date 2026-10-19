// Composer for orders to one agent or to a whole room: quick chips, Cmd/Ctrl+Enter, inline errors, per-target drafts.
import type { AppContext, Component } from '../context';
import { LOCAL_ONLY_HINT } from '../context';
import { h, setText } from '../dom';
import { describeError } from '../../net/backend';
import { MAX_MESSAGE_LENGTH, QUICK_MESSAGES, validateMessageText } from '../model/messages';
import { icon } from '../icons';
import { setDisabled } from '../widgets';

export interface ComposerTarget {
  /** Identifies the draft (agent or room id). */
  key: string;
  agentIds: readonly string[];
  /** Room name for team messages. */
  teamLabel?: string;
  placeholder: string;
  sendLabel: string;
  /** Why sending is not possible right now (shown instead of the form), or null. */
  blockedReason: string | null;
}

export class MessageComposer implements Component {
  readonly el = h('div', { class: 'ao-composer' });
  private readonly textarea: HTMLTextAreaElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly sendLabel: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly error: HTMLElement;
  private readonly blocked: HTMLElement;
  private readonly form: HTMLElement;
  private readonly drafts = new Map<string, string>();
  private target: ComposerTarget | null = null;
  private sending = false;
  private lastFocusToken = 0;

  constructor(
    private readonly ctx: AppContext,
    private readonly onSent: () => void = () => undefined,
  ) {
    this.textarea = h('textarea', { class: 'ao-textarea', rows: 3, maxlength: MAX_MESSAGE_LENGTH + 200, spellcheck: 'true' });
    this.textarea.addEventListener('input', () => {
      if (this.target) this.drafts.set(this.target.key, this.textarea.value);
      this.error.hidden = true;
      this.updateSendState();
    });
    this.textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void this.send();
      }
    });
    this.chips = h(
      'div',
      { class: 'ao-quick', role: 'group', 'aria-label': 'Mensagens rápidas' },
      ...QUICK_MESSAGES.map((text) => h('button', { type: 'button', class: 'ao-quick-chip', title: text, onclick: () => this.insertQuick(text) }, text)),
    );
    this.sendLabel = h('span', null, 'Enviar');
    this.sendBtn = h('button', { type: 'button', class: 'ao-btn ao-btn--primary', onclick: () => void this.send() }, icon('send', 16), this.sendLabel);
    this.hint = h('span', { class: 'ao-hint' }, this.shortcutHint());
    this.error = h('p', { class: 'ao-error', role: 'alert', hidden: true });
    this.blocked = h('p', { class: 'ao-note ao-composer-blocked', hidden: true });
    this.form = h('div', { class: 'ao-composer-form' }, this.chips, this.textarea, h('div', { class: 'ao-composer-bar' }, this.hint, this.sendBtn), this.error);
    this.el.append(this.blocked, this.form);
  }

  private shortcutHint(): string {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    return `${mac ? '⌘' : 'Ctrl'}+Enter para enviar`;
  }

  setTarget(target: ComposerTarget): void {
    const previous = this.target;
    this.target = target;
    if (previous?.key !== target.key) {
      this.textarea.value = this.drafts.get(target.key) ?? '';
      this.error.hidden = true;
    }
    this.textarea.placeholder = target.placeholder;
    setText(this.sendLabel, target.sendLabel);
    this.blocked.hidden = target.blockedReason === null;
    this.form.hidden = target.blockedReason !== null;
    if (target.blockedReason) setText(this.blocked, target.blockedReason);
    this.updateSendState();
  }

  focus(): void {
    this.textarea.focus();
  }

  /** Honors "N" / "Mensagem" requests from elsewhere in the UI. */
  render(): void {
    const token = this.ctx.ui.get().composerFocus;
    if (token !== this.lastFocusToken) {
      this.lastFocusToken = token;
      if (this.el.offsetParent !== null && this.target?.blockedReason === null) this.focus();
    }
    this.updateSendState();
  }

  private insertQuick(text: string): void {
    const current = this.textarea.value.trim();
    this.textarea.value = current ? `${current}\n${text}` : text;
    this.textarea.dispatchEvent(new Event('input'));
    this.focus();
  }

  private updateSendState(): void {
    const target = this.target;
    const empty = this.textarea.value.trim().length === 0;
    const reason = !this.ctx.isLocal ? LOCAL_ONLY_HINT : undefined;
    setDisabled(this.sendBtn, this.sending || empty || !target || target.agentIds.length === 0 || !this.ctx.isLocal, reason);
    setDisabled(this.textarea, !this.ctx.isLocal, reason);
  }

  private async send(): Promise<void> {
    const target = this.target;
    if (!target || this.sending) return;
    const check = validateMessageText(this.textarea.value);
    if (!check.ok) {
      this.showError(check.error);
      return;
    }
    this.sending = true;
    this.updateSendState();
    try {
      await this.ctx.sendMessage(target.agentIds, check.text, target.teamLabel);
      if (this.target?.key === target.key) this.textarea.value = '';
      this.drafts.delete(target.key);
      this.error.hidden = true;
      this.onSent();
    } catch (error) {
      this.showError(describeError(error));
    } finally {
      this.sending = false;
      this.updateSendState();
    }
  }

  private showError(message: string): void {
    setText(this.error, message);
    this.error.hidden = false;
  }
}
