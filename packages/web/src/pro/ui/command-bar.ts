// The command bar: send a task to an orchestrator (or to the team of a room) by typing or, when the local voice input
// exists, by speaking. Uses the same message client as the drawer's composer, so delivery works exactly as it does
// there, and says plainly what will happen to the message given what the agent is doing.
import type { BossMessage } from '@ai-office/shared';
import { locale, t, tm, type TextKey } from '../../i18n';
import { describeError } from '../../net/backend';
import type { AppContext } from '../../ui/context';
import { localOnlyHint } from '../../ui/context';
import { h, setAttr, setText, toggleClass } from '../../ui/dom';
import { formatClock } from '../../ui/format';
import { icon } from '../../ui/icons';
import {
  groupMessages,
  groupStatusLabel,
  MAX_MESSAGE_LENGTH,
  quickMessages,
  validateMessageText,
} from '../../ui/model/messages';
import { setDisabled } from '../../ui/widgets';
import type { VoiceInput, VoiceStatus } from '../../voice/types';
import {
  buildTargets,
  canSend,
  defaultTargetKey,
  resolveTargetKey,
  type BlockReason,
  type CommandTarget,
  type DeliveryOutlook,
} from '../model/command';

const OUTLOOK_KEY: Record<Exclude<DeliveryOutlook, 'blocked'>, TextKey> = {
  afterTool: 'pro.command.outlook.afterTool',
  standby: 'pro.command.outlook.standby',
  beyondStandby: 'pro.command.outlook.beyondStandby',
  afterPermission: 'pro.command.outlook.afterPermission',
};

const BLOCK_KEY: Record<Exclude<BlockReason, 'local'>, TextKey> = {
  nobody: 'room.team.nobody',
  codex: 'codex.readonly.message',
  ended: 'pro.command.blocked.ended',
  'team-codex': 'codex.readonly.team',
};

interface LastSent {
  messageIds: ReadonlySet<string>;
  agentIds: readonly string[];
  label: string;
}

export class CommandBar {
  readonly el = h('section', { class: 'ao-pro-command', 'aria-label': t('pro.command.label') });
  private readonly select = h('select', { class: 'ao-select ao-pro-target', 'aria-label': t('pro.command.target') });
  private readonly outlook = h('p', { class: 'ao-pro-outlook' });
  private readonly textarea: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly micButton: HTMLButtonElement;
  private readonly micLabel = h('span', { class: 'ao-pro-mic-label' });
  private readonly delivery = h('p', {
    class: 'ao-pro-delivery ao-pro-foot-status',
    'aria-live': 'polite',
    hidden: true,
  });
  private readonly error = h('p', { class: 'ao-error ao-pro-foot-status', role: 'alert', hidden: true });
  private readonly hint = h('span', { class: 'ao-hint ao-pro-foot-status' });
  private readonly drafts = new Map<string, string>();
  private targets: CommandTarget[] = [];
  private chosenKey: string | null = null;
  private currentKey: string | null = null;
  private optionsSignature = '';
  private sending = false;
  private lastSent: LastSent | null = null;
  private lastFocusToken = 0;
  private voiceStatus: VoiceStatus = { state: 'unavailable' };
  private unsubscribeVoice: (() => void) | null = null;

  constructor(
    private readonly ctx: AppContext,
    private readonly voice: VoiceInput | null,
  ) {
    this.textarea = h('textarea', {
      class: 'ao-textarea ao-pro-prompt',
      rows: 2,
      maxlength: MAX_MESSAGE_LENGTH + 200,
      spellcheck: 'true',
      'aria-label': t('pro.command.label'),
    });
    this.textarea.addEventListener('input', () => {
      if (this.currentKey !== null) this.drafts.set(this.currentKey, this.textarea.value);
      this.error.hidden = true;
      this.syncFootStatus();
      this.updateState();
    });
    this.textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void this.send();
      }
    });
    this.select.addEventListener('change', () => {
      this.chosenKey = this.select.value;
      this.render();
    });
    this.sendButton = h(
      'button',
      { type: 'button', class: 'ao-btn ao-btn--primary ao-pro-send', onclick: () => void this.send() },
      icon('send', 16),
      h('span', null, t('common.send')),
    );
    this.micButton = h(
      'button',
      { type: 'button', class: 'ao-btn ao-btn--soft ao-pro-mic', onclick: () => void this.onMic() },
      icon('mic', 16),
      this.micLabel,
    );
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    this.el.append(
      h('div', { class: 'ao-pro-command-top' }, this.select, this.outlook),
      h(
        'div',
        { class: 'ao-pro-command-main' },
        this.textarea,
        h('div', { class: 'ao-pro-command-buttons' }, this.micButton, this.sendButton),
      ),
      h(
        'div',
        { class: 'ao-pro-command-foot' },
        h(
          'div',
          { class: 'ao-quick', role: 'group', 'aria-label': t('composer.quick') },
          ...quickMessages().map((text) =>
            h(
              'button',
              { type: 'button', class: 'ao-quick-chip', title: text, onclick: () => this.insert(text) },
              text,
            ),
          ),
        ),
        this.hint,
        this.delivery,
        this.error,
      ),
    );
    setText(this.hint, t('composer.hint', { key: mac ? '⌘' : 'Ctrl' }));
    if (voice !== null) {
      this.voiceStatus = voice.status();
      voice.setLanguage(locale());
      this.unsubscribeVoice = voice.onStatus((status) => {
        this.voiceStatus = status;
        this.renderMic();
      });
    }
  }

  dispose(): void {
    this.unsubscribeVoice?.();
    this.unsubscribeVoice = null;
  }

  /** Puts the focus in the prompt (the "N" key, or a click on a terminal's "send an order"). */
  focus(): void {
    this.textarea.focus();
  }

  // --- rendering --------------------------------------------------------------------------------------------------

  render(): void {
    const snapshot = this.ctx.liveSnapshot;
    const now = this.ctx.now();
    this.targets = buildTargets(snapshot, now, this.ctx.isLocal);
    const selected = this.ctx.ui.get().selection;
    const fallback = defaultTargetKey(this.targets, snapshot, selected?.type === 'agent' ? selected.id : null);
    // A new selection in the office or on the canvas moves the target, unless the user picked one in the list.
    const key = resolveTargetKey(this.targets, this.chosenKey, fallback);
    this.syncOptions();
    if (key !== this.currentKey) this.switchTarget(key);
    const target = this.currentTarget();
    this.select.value = key ?? '';
    this.renderOutlook(target);
    this.renderDelivery();
    this.honorFocusRequest();
    this.updateState();
    this.renderMic();
  }

  /** Called when the selection moves: the target follows it again. */
  followSelection(): void {
    this.chosenKey = null;
  }

  private currentTarget(): CommandTarget | undefined {
    return this.targets.find((target) => target.key === this.currentKey);
  }

  private syncOptions(): void {
    const signature = this.targets.map((target) => `${target.key}:${target.label}:${target.roomName}`).join('|');
    if (signature === this.optionsSignature) return;
    this.optionsSignature = signature;
    const groups = new Map<string, HTMLOptGroupElement>();
    const children: Node[] = [];
    for (const target of this.targets) {
      let group = groups.get(target.roomName);
      if (group === undefined) {
        group = h('optgroup', { label: target.roomName });
        groups.set(target.roomName, group);
        children.push(group);
      }
      const label = target.kind === 'room' ? t('pro.command.team', { room: target.roomName }) : target.label;
      group.appendChild(h('option', { value: target.key }, label));
    }
    if (this.targets.length === 0) children.push(h('option', { value: '' }, t('pro.command.noTarget')));
    this.select.replaceChildren(...children);
  }

  private switchTarget(key: string | null): void {
    this.currentKey = key;
    this.textarea.value = key === null ? '' : (this.drafts.get(key) ?? '');
    this.error.hidden = true;
    this.syncFootStatus();
  }

  private renderOutlook(target: CommandTarget | undefined): void {
    const { text, kind } = this.outlookText(target);
    setText(this.outlook, text);
    this.outlook.className = `ao-pro-outlook is-${kind}`;
    this.textarea.placeholder =
      target?.kind === 'room' ? t('pro.command.placeholder.team') : t('pro.command.placeholder');
  }

  private outlookText(target: CommandTarget | undefined): { text: string; kind: 'ok' | 'warn' | 'blocked' } {
    if (target === undefined) return { text: t('pro.command.noTarget'), kind: 'blocked' };
    if (target.blocked !== null) {
      const text = target.blocked === 'local' ? localOnlyHint() : t(BLOCK_KEY[target.blocked]);
      return { text, kind: 'blocked' };
    }
    if (target.outlook === 'blocked') return { text: t('pro.command.blocked.ended'), kind: 'blocked' };
    const base = t(OUTLOOK_KEY[target.outlook]);
    const skipped = target.skipped > 0 ? ` ${t('codex.readonly.skipped', { n: target.skipped })}` : '';
    const team = target.kind === 'room' ? `${t('pro.command.teamCount', { n: target.agentIds.length })} ` : '';
    const warn = target.outlook === 'beyondStandby' || target.outlook === 'afterPermission';
    return { text: `${team}${base}${skipped}`, kind: warn ? 'warn' : 'ok' };
  }

  private renderDelivery(): void {
    const last = this.lastSent;
    if (last === null) {
      this.delivery.hidden = true;
      this.syncFootStatus();
      return;
    }
    const messages: BossMessage[] = last.agentIds
      .flatMap((id) => this.ctx.messages.messagesOf(id))
      .filter((message) => last.messageIds.has(message.id));
    const group = groupMessages(messages)[0];
    this.delivery.hidden = group === undefined || !this.error.hidden;
    this.syncFootStatus();
    if (group === undefined) return;
    setText(
      this.delivery,
      t('pro.command.last', {
        target: last.label,
        time: formatClock(group.createdAt),
        status: groupStatusLabel(group),
      }),
    );
    toggleClass(this.delivery, 'is-pending', group.queued > 0);
    toggleClass(this.delivery, 'is-expired', group.expired > 0 && group.queued === 0);
  }

  private honorFocusRequest(): void {
    const token = this.ctx.ui.get().composerFocus;
    if (token === this.lastFocusToken) return;
    this.lastFocusToken = token;
    if (this.el.offsetParent !== null) this.focus();
  }

  private updateState(): void {
    const target = this.currentTarget();
    const reason = target?.blocked === 'local' ? localOnlyHint() : undefined;
    setDisabled(this.sendButton, !canSend(target, this.textarea.value, this.sending), reason);
    setDisabled(this.textarea, target === undefined || target.blocked !== null, this.outlook.textContent ?? undefined);
  }

  private insert(text: string): void {
    const current = this.textarea.value.trim();
    this.textarea.value = current ? `${current}\n${text}` : text;
    this.textarea.dispatchEvent(new Event('input'));
    this.focus();
  }

  // --- sending ----------------------------------------------------------------------------------------------------

  private async send(): Promise<void> {
    const target = this.currentTarget();
    if (target === undefined || this.sending || !canSend(target, this.textarea.value, false)) return;
    const check = validateMessageText(this.textarea.value);
    if (!check.ok) {
      this.showError(check.error);
      return;
    }
    this.sending = true;
    this.updateState();
    try {
      const sent = await this.ctx.sendMessage(
        target.agentIds,
        check.text,
        target.kind === 'room' ? target.roomName : undefined,
      );
      this.lastSent = {
        messageIds: new Set(sent.map((message) => message.id)),
        agentIds: sent.map((message) => message.agentId),
        label: target.kind === 'room' ? t('pro.command.team', { room: target.roomName }) : target.label,
      };
      if (this.currentKey === target.key) this.textarea.value = '';
      this.drafts.delete(target.key);
      this.error.hidden = true;
      this.syncFootStatus();
    } catch (error) {
      this.showError(describeError(error));
    } finally {
      this.sending = false;
      this.updateState();
      this.renderDelivery();
    }
  }

  private showError(message: string): void {
    setText(this.error, message);
    this.error.hidden = false;
    this.syncFootStatus();
  }

  /** The line at the right of the quick prompts: an error first, else the last order's delivery, else the key hint. */
  private syncFootStatus(): void {
    this.hint.hidden = !this.error.hidden || !this.delivery.hidden;
    if (!this.error.hidden) this.delivery.hidden = true;
  }

  // --- voice ------------------------------------------------------------------------------------------------------

  private renderMic(): void {
    const voice = this.voice;
    const status = this.voiceStatus;
    const percent = Math.round((status.progress ?? 0) * 100);
    let label: string;
    let hint: string;
    let disabled = false;
    if (voice === null || status.state === 'unavailable') {
      label = t('pro.voice.label');
      hint =
        status.errorKey !== undefined
          ? tm({ key: status.errorKey }, t('pro.voice.unavailable'))
          : t('pro.voice.unavailable');
      disabled = true;
    } else {
      switch (status.state) {
        case 'off':
          label = t('pro.voice.prepare');
          hint = t('pro.voice.prepare.hint');
          break;
        case 'downloading':
          label = t('pro.voice.downloading', { percent });
          hint = t('pro.voice.downloading.hint');
          disabled = true;
          break;
        case 'loading':
          label = t('pro.voice.loading', { percent });
          hint = t('pro.voice.loading.hint');
          disabled = true;
          break;
        case 'listening':
          label = t('pro.voice.stop');
          hint = t('pro.voice.stop.hint');
          break;
        case 'transcribing':
          label = t('pro.voice.transcribing');
          hint = t('pro.voice.transcribing');
          disabled = true;
          break;
        case 'error':
          label = t('pro.voice.retry');
          hint =
            status.errorKey !== undefined ? tm({ key: status.errorKey }, t('pro.voice.error')) : t('pro.voice.error');
          break;
        default:
          label = t('pro.voice.start');
          hint = t('pro.voice.start.hint');
      }
    }
    setText(this.micLabel, label);
    this.micButton.disabled = disabled;
    setAttr(this.micButton, 'title', hint);
    setAttr(this.micButton, 'aria-label', `${label}. ${hint}`);
    setAttr(this.micButton, 'aria-pressed', status.state === 'listening' ? 'true' : 'false');
    toggleClass(this.micButton, 'is-listening', status.state === 'listening');
    toggleClass(this.micButton, 'is-busy', ['downloading', 'loading', 'transcribing'].includes(status.state));
  }

  private async onMic(): Promise<void> {
    const voice = this.voice;
    if (voice === null) return;
    try {
      switch (voice.status().state) {
        case 'off':
        case 'error':
          await voice.prepare();
          break;
        case 'ready':
          await voice.start();
          break;
        case 'listening': {
          const text = (await voice.stop()).trim();
          if (text !== '') {
            this.insert(text);
            this.ctx.announce(t('pro.voice.inserted'));
          }
          break;
        }
        default:
          break;
      }
    } catch {
      this.showError(t('pro.voice.error'));
    }
  }
}
