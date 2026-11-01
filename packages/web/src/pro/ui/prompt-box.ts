// The prompt of the Pro view, shared by the command bar and the room panel: a multiline box (Cmd/Ctrl+Enter sends),
// the microphone of the local voice input, the sentence that says what will happen to the order given what the target
// is doing, and the delivery line of the last order. It sends with the same message client as the drawer's composer.
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
import { canSend, type BlockReason, type CommandTarget, type DeliveryOutlook } from '../model/command';
import {
  activeToken,
  addPrompt,
  MAX_PROMPT_LENGTH,
  removePrompt,
  replaceToken,
  type PromptToken,
} from '../model/mentions';
import { micView } from '../model/mic';
import { searchPalette } from '../model/palette';
import { PromptMenu, type MenuRow } from './prompt-menu';

const OUTLOOK_KEY: Record<Exclude<DeliveryOutlook, 'blocked'>, TextKey> = {
  afterTool: 'pro.command.outlook.afterTool',
  standby: 'pro.command.outlook.standby',
  beyondStandby: 'pro.command.outlook.beyondStandby',
  afterPermission: 'pro.command.outlook.afterPermission',
};

/** Rows of the `@` and `$` lists. */
const MENU_LIMIT = 12;
/** How long a project's file list is reused before asking the server again. */
const FILES_TTL_MS = 30_000;

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

export interface PromptOptions {
  /** The accessible name of the box. */
  label: string;
  /** Put before the outlook sentence in the top row (the command bar's target selector). */
  head?: HTMLElement;
  /** Show the four quick prompts under the box. */
  quick: boolean;
}

/** The sentence under the target: what will happen to an order sent now. */
export function outlookText(target: CommandTarget | undefined): { text: string; kind: 'ok' | 'warn' | 'blocked' } {
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

export function targetLabel(target: CommandTarget): string {
  return target.kind === 'room' ? t('pro.command.team', { room: target.roomName }) : target.label;
}

export class PromptBox {
  readonly el: HTMLElement;
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
  private target: CommandTarget | undefined;
  private currentKey: string | null = null;
  private sending = false;
  private lastSent: LastSent | null = null;
  private voiceStatus: VoiceStatus = { state: 'unavailable' };
  /** The target the dictation in progress was started for (null when this box is not recording). */
  private recordingKey: string | null = null;
  private unsubscribeVoice: (() => void) | null = null;
  private readonly menu: PromptMenu;
  private readonly saveButton: HTMLButtonElement;
  private token: PromptToken | null = null;
  private files: { projectId: string; at: number; list: readonly string[] } | null = null;

  constructor(
    private readonly ctx: AppContext,
    private readonly voice: VoiceInput | null,
    options: PromptOptions,
  ) {
    this.textarea = h('textarea', {
      class: 'ao-textarea ao-pro-prompt',
      rows: 2,
      maxlength: MAX_MESSAGE_LENGTH + 200,
      spellcheck: 'true',
      'aria-label': options.label,
    });
    this.menu = new PromptMenu({
      pick: (id) => this.pickMenu(id),
      remove: (id) => this.deletePrompt(id),
    });
    this.saveButton = h(
      'button',
      { type: 'button', class: 'ao-quick-chip ao-pro-save-prompt', onclick: () => this.savePrompt() },
      t('pro.prompts.save'),
    );
    this.textarea.addEventListener('input', () => {
      if (this.currentKey !== null) this.drafts.set(this.currentKey, this.textarea.value);
      this.error.hidden = true;
      this.syncFootStatus();
      this.updateState();
      this.syncMenu();
    });
    this.textarea.addEventListener('blur', () => this.closeMenu());
    this.textarea.addEventListener('keydown', (event) => {
      if (this.onMenuKey(event)) return;
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void this.send();
      }
    });
    this.sendButton = h(
      'button',
      { type: 'button', class: 'ao-btn ao-btn--primary ao-pro-send', onclick: () => void this.send() },
      icon('send', 15),
      h('span', null, t('common.send')),
    );
    this.micButton = h(
      'button',
      { type: 'button', class: 'ao-btn ao-btn--soft ao-pro-mic', onclick: () => void this.onMic() },
      icon('mic', 15),
      this.micLabel,
    );
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    setText(this.hint, t('composer.hint', { key: mac ? '⌘' : 'Ctrl' }));
    const quick = options.quick
      ? h(
          'div',
          { class: 'ao-quick', role: 'group', 'aria-label': t('composer.quick') },
          ...quickMessages().map((text) =>
            h(
              'button',
              { type: 'button', class: 'ao-quick-chip', title: text, onclick: () => this.insert(text) },
              text,
            ),
          ),
        )
      : h('span', { class: 'ao-pro-foot-gap' });
    this.el = h(
      'div',
      { class: 'ao-pro-promptbox' },
      h('div', { class: 'ao-pro-command-top' }, ...(options.head !== undefined ? [options.head] : []), this.outlook),
      h(
        'div',
        { class: 'ao-pro-command-main' },
        h('div', { class: 'ao-pro-prompt-wrap' }, this.menu.el, this.textarea),
        h('div', { class: 'ao-pro-command-buttons' }, this.micButton, this.sendButton),
      ),
      h('div', { class: 'ao-pro-command-foot' }, quick, this.saveButton, this.hint, this.delivery, this.error),
    );
    if (voice !== null) {
      this.voiceStatus = voice.status();
      voice.setLanguage(locale());
      this.unsubscribeVoice = voice.onStatus((status) => {
        this.voiceStatus = status;
        // A dictation that ended by itself (an error, the page took the microphone back) no longer belongs to this box.
        if (status.state !== 'listening' && status.state !== 'transcribing') this.recordingKey = null;
        this.renderMic();
      });
    }
  }

  dispose(): void {
    this.unsubscribeVoice?.();
    this.unsubscribeVoice = null;
  }

  focus(): void {
    this.textarea.focus();
  }

  get focused(): boolean {
    return document.activeElement === this.textarea;
  }

  /** Aims the box at a target (or none); each target keeps its own draft. */
  setTarget(target: CommandTarget | undefined): void {
    this.target = target;
    const key = target?.key ?? null;
    if (key !== this.currentKey) {
      this.currentKey = key;
      this.textarea.value = key === null ? '' : (this.drafts.get(key) ?? '');
      this.error.hidden = true;
      this.syncFootStatus();
    }
    const { text, kind } = outlookText(target);
    setText(this.outlook, text);
    this.outlook.className = `ao-pro-outlook is-${kind}`;
    this.textarea.placeholder =
      target?.kind === 'room' ? t('pro.command.placeholder.team') : t('pro.command.placeholder');
    this.renderDelivery();
    this.updateState();
    this.renderMic();
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

  private updateState(): void {
    const target = this.target;
    const reason = target?.blocked === 'local' ? localOnlyHint() : undefined;
    setDisabled(this.sendButton, !canSend(target, this.textarea.value, this.sending), reason);
    setDisabled(this.textarea, target === undefined || target.blocked !== null, this.outlook.textContent ?? undefined);
    const text = this.textarea.value.trim();
    setDisabled(this.saveButton, text === '' || text.length > MAX_PROMPT_LENGTH);
  }

  private insert(text: string): void {
    const current = this.textarea.value.trim();
    this.textarea.value = current ? `${current}\n${text}` : text;
    this.textarea.dispatchEvent(new Event('input'));
    this.focus();
  }

  // --- `@` files and `$` saved prompts --------------------------------------------------------------------------

  private closeMenu(): void {
    this.token = null;
    this.menu.hide();
  }

  private syncMenu(): void {
    const caret = this.textarea.selectionStart;
    this.token = this.textarea.selectionEnd === caret ? activeToken(this.textarea.value, caret) : null;
    if (this.token === null) return this.menu.hide();
    if (this.token.trigger === '$') this.showPrompts(this.token.query);
    else void this.showFiles(this.token);
  }

  private showPrompts(query: string): void {
    const prompts = this.ctx.prefs.get().proPrompts;
    if (prompts.length === 0) {
      this.menu.show([{ id: '', title: t('pro.prompts.empty'), note: true }]);
      return;
    }
    const items = prompts.map((prompt) => ({
      id: prompt.id,
      kind: 'action' as const,
      title: prompt.name,
      detail: '',
      words: prompt.text,
      waiting: false,
    }));
    const rows = searchPalette(items, query, MENU_LIMIT).map((item): MenuRow => ({
      id: item.id,
      title: item.title,
      removeLabel: t('pro.prompts.remove', { name: item.title }),
    }));
    this.menu.show(rows);
  }

  /** The room the order goes to; a room's own id, or the room of the agent. */
  private targetProject(): string | undefined {
    const target = this.target;
    if (target === undefined) return undefined;
    if (target.kind === 'room') return target.key.slice('room:'.length);
    const agentId = target.agentIds[0];
    return agentId === undefined ? undefined : this.ctx.agent(agentId)?.projectId;
  }

  private async showFiles(token: PromptToken): Promise<void> {
    const projectId = this.targetProject();
    if (projectId === undefined || !this.ctx.isLocal) return this.menu.hide();
    const list = await this.filesOf(projectId);
    // The person kept typing while the list was on its way: a newer key press already drew the menu.
    if (this.token !== token) return;
    const items = list.map((file) => ({
      id: file,
      kind: 'action' as const,
      title: file,
      detail: '',
      words: '',
      waiting: false,
    }));
    const found = searchPalette(items, token.query, MENU_LIMIT);
    this.menu.show(
      found.length > 0
        ? found.map((item): MenuRow => ({ id: item.id, title: item.title }))
        : [{ id: '', title: t('pro.files.none'), note: true }],
    );
  }

  private async filesOf(projectId: string): Promise<readonly string[]> {
    const now = this.ctx.now();
    if (this.files?.projectId === projectId && now - this.files.at < FILES_TTL_MS) return this.files.list;
    try {
      const { files } = await this.ctx.store.backend.projectFiles(projectId);
      this.files = { projectId, at: now, list: files };
      return files;
    } catch {
      return [];
    }
  }

  private pickMenu(id: string): void {
    const token = this.token;
    if (token === null) return;
    const insert =
      token.trigger === '@'
        ? `@${id} `
        : (this.ctx.prefs.get().proPrompts.find((prompt) => prompt.id === id)?.text ?? '');
    const next = replaceToken(this.textarea.value, token, insert);
    this.textarea.value = next.text;
    this.textarea.setSelectionRange(next.caret, next.caret);
    this.closeMenu();
    this.textarea.dispatchEvent(new Event('input'));
    this.closeMenu();
  }

  /** Handles the keys of an open list; true when it used the key. */
  private onMenuKey(event: KeyboardEvent): boolean {
    if (!this.menu.isOpen) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') this.menu.move(event.key === 'ArrowDown' ? 1 : -1);
    else if (event.key === 'Escape') {
      this.closeMenu();
      event.stopPropagation();
    } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.metaKey && !event.ctrlKey) {
      if (!this.menu.pickCurrent()) this.closeMenu();
    } else return false;
    event.preventDefault();
    return true;
  }

  private savePrompt(): void {
    const text = this.textarea.value.trim();
    if (text === '' || text.length > MAX_PROMPT_LENGTH) return;
    const proPrompts = addPrompt(this.ctx.prefs.get().proPrompts, `p${this.ctx.now()}`, text);
    this.ctx.prefs.set({ proPrompts });
    this.ctx.announce(t('pro.prompts.saved'));
  }

  private deletePrompt(id: string): void {
    const proPrompts = removePrompt(this.ctx.prefs.get().proPrompts, id);
    this.ctx.prefs.set({ proPrompts });
    this.syncMenu();
  }

  // --- sending ----------------------------------------------------------------------------------------------------

  private async send(): Promise<void> {
    const target = this.target;
    if (target === undefined || this.sending || !canSend(target, this.textarea.value, false)) return;
    const check = validateMessageText(this.textarea.value);
    if (!check.ok) {
      this.showError(check.error);
      return;
    }
    const typed = this.textarea.value;
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
        label: targetLabel(target),
      };
      // Only what was sent is cleared: text typed while the order was on its way stays.
      if (this.currentKey === target.key && this.textarea.value === typed) this.textarea.value = '';
      if (this.drafts.get(target.key) === typed) this.drafts.delete(target.key);
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

  /** The line at the right: an error first, else the last order's delivery, else the key hint. */
  private syncFootStatus(): void {
    this.hint.hidden = !this.error.hidden || !this.delivery.hidden;
    if (!this.error.hidden) this.delivery.hidden = true;
  }

  // --- voice ------------------------------------------------------------------------------------------------------

  private renderMic(): void {
    const view = micView(this.voice !== null, this.voiceStatus, this.recordingKey !== null);
    const label = t(view.label, { percent: view.percent });
    const hint =
      view.errorKey !== undefined ? tm({ key: view.errorKey }, t(view.hint)) : t(view.hint, { percent: view.percent });
    setText(this.micLabel, label);
    this.micButton.disabled = view.disabled;
    setAttr(this.micButton, 'title', hint);
    setAttr(this.micButton, 'aria-label', `${label}. ${hint}`);
    setAttr(this.micButton, 'aria-pressed', view.listening ? 'true' : 'false');
    toggleClass(this.micButton, 'is-listening', view.listening);
    toggleClass(this.micButton, 'is-busy', view.busy);
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
          this.recordingKey = this.currentKey ?? '';
          await voice.start();
          break;
        case 'listening': {
          if (this.recordingKey === null) return;
          const key = this.recordingKey;
          const text = (await voice.stop()).trim();
          this.recordingKey = null;
          if (text !== '') this.insertDictation(key, text);
          this.renderMic();
          break;
        }
        default:
          break;
      }
    } catch {
      this.recordingKey = null;
      this.showError(t('pro.voice.error'));
    }
  }

  /** The dictation goes to the target it was recorded for, even if the box was aimed elsewhere meanwhile. */
  private insertDictation(key: string, text: string): void {
    if (key === this.currentKey) this.insert(text);
    else {
      const draft = (this.drafts.get(key) ?? '').trim();
      this.drafts.set(key, draft ? `${draft}\n${text}` : text);
    }
    this.ctx.announce(t('pro.voice.inserted'));
  }
}
