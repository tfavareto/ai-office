// Confirmation sheet of the task board: shows the exact message that a move (or a new task) will send, editable,
// before it goes to the agent. Nothing is sent without this step.
import { t } from '../../i18n';
import { describeError } from '../../net/backend';
import type { AppContext } from '../context';
import { localOnlyHint } from '../context';
import { h, setText } from '../dom';
import type { BoardColumnId } from '../model/board';
import { buildAddIntent, type MoveIntent } from '../model/board-moves';
import { MAX_MESSAGE_LENGTH, validateMessageText } from '../model/messages';
import { setDisabled } from '../widgets';
import { COLUMN_KEYS } from './board-card';

export interface AgentChoice {
  id: string;
  label: string;
}

type SendHandler = (intent: MoveIntent, text: string) => Promise<void>;

export class MessageSheet {
  readonly el = h('div', { class: 'ao-board-sheet-scrim', hidden: true });
  private readonly title = h('h3', { id: 'ao-board-sheet-title' });
  private readonly fields = h('div', { class: 'ao-board-sheet-fields' });
  private readonly agentSelect = h('select', { class: 'ao-select ao-board-agent-select', id: 'ao-board-sheet-agent' });
  private readonly titleInput = h('input', { class: 'ao-input', id: 'ao-board-sheet-task', type: 'text', maxlength: 200, placeholder: t('board.add.placeholder') });
  private readonly textarea = h('textarea', { class: 'ao-textarea', id: 'ao-board-sheet-text', rows: 3, maxlength: MAX_MESSAGE_LENGTH + 200 });
  private readonly error = h('p', { class: 'ao-error', role: 'alert', hidden: true });
  private readonly sendBtn = h('button', { type: 'button', class: 'ao-btn ao-btn--primary' }, h('span', null, t('board.confirm.send')));
  private intent: MoveIntent | null = null;
  private addColumn: BoardColumnId | null = null;
  private edited = false;
  private sending = false;
  private returnTo: HTMLElement | null = null;
  private onSend: SendHandler = () => Promise.resolve();

  constructor(private readonly ctx: AppContext) {
    const cancel = h('button', { type: 'button', class: 'ao-btn ao-btn--ghost' }, t('common.cancel'));
    cancel.addEventListener('click', () => this.close());
    this.sendBtn.addEventListener('click', () => void this.send());
    this.textarea.addEventListener('input', () => {
      this.edited = true;
      this.refreshState();
    });
    this.textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void this.send();
      }
    });
    this.agentSelect.addEventListener('change', () => this.rebuildAddIntent());
    this.titleInput.addEventListener('input', () => this.rebuildAddIntent());
    this.fields.append(
      h('label', { class: 'ao-board-field', for: 'ao-board-sheet-agent' }, h('span', null, t('board.add.agent')), this.agentSelect),
      h('label', { class: 'ao-board-field', for: 'ao-board-sheet-task' }, h('span', null, t('board.add.task')), this.titleInput),
    );
    const sheet = h(
      'div',
      { class: 'ao-board-sheet', role: 'group', 'aria-labelledby': 'ao-board-sheet-title' },
      this.title,
      h('p', { class: 'ao-note' }, t('board.confirm.hint')),
      this.fields,
      h('label', { class: 'ao-board-field', for: 'ao-board-sheet-text' }, h('span', null, t('board.confirm.label')), this.textarea),
      this.error,
      h('div', { class: 'ao-board-sheet-bar' }, cancel, this.sendBtn),
    );
    this.el.append(sheet);
    this.el.addEventListener('pointerdown', (event) => {
      if (event.target === this.el) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Confirms a move of an existing card. */
  openMove(intent: MoveIntent, recipientName: string, opener: HTMLElement | null, onSend: SendHandler): void {
    this.begin(opener, onSend);
    this.fields.hidden = true;
    this.intent = intent;
    this.addColumn = null;
    setText(this.title, t('board.confirm.title', { name: recipientName }));
    this.textarea.value = intent.text;
    this.finish(this.textarea);
  }

  /** Asks for a new task: pick the agent, name the task, check the message. */
  openAdd(column: BoardColumnId, agents: readonly AgentChoice[], defaultAgentId: string | null, opener: HTMLElement | null, onSend: SendHandler): void {
    this.begin(opener, onSend);
    this.fields.hidden = false;
    this.addColumn = column;
    this.agentSelect.replaceChildren(...agents.map((agent) => h('option', { value: agent.id }, agent.label)));
    if (defaultAgentId !== null && agents.some((agent) => agent.id === defaultAgentId)) this.agentSelect.value = defaultAgentId;
    this.titleInput.value = '';
    setText(this.title, `${t('board.add.title')} · ${t(COLUMN_KEYS[column])}`);
    this.textarea.value = '';
    this.intent = null;
    this.finish(this.titleInput);
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.intent = null;
    this.returnTo?.focus({ preventScroll: true });
    this.returnTo = null;
  }

  private begin(opener: HTMLElement | null, onSend: SendHandler): void {
    this.returnTo = opener;
    this.onSend = onSend;
    this.edited = false;
    this.error.hidden = true;
  }

  private finish(focus: HTMLElement): void {
    this.el.hidden = false;
    this.refreshState();
    focus.focus({ preventScroll: true });
  }

  private rebuildAddIntent(): void {
    if (this.addColumn === null) return;
    this.intent = buildAddIntent(this.agentSelect.value, this.addColumn, this.titleInput.value);
    if (!this.edited) this.textarea.value = this.intent?.text ?? '';
    this.refreshState();
  }

  private refreshState(): void {
    const blocked = !this.ctx.isLocal ? localOnlyHint() : undefined;
    const empty = this.textarea.value.trim().length === 0 || this.intent === null;
    setDisabled(this.sendBtn, this.sending || empty || !this.ctx.isLocal, blocked);
  }

  private async send(): Promise<void> {
    const intent = this.intent;
    if (!intent || this.sending) return;
    const check = validateMessageText(this.textarea.value);
    if (!check.ok) {
      setText(this.error, check.error);
      this.error.hidden = false;
      return;
    }
    this.sending = true;
    this.refreshState();
    try {
      await this.onSend(intent, check.text);
      this.close();
    } catch (error) {
      setText(this.error, describeError(error));
      this.error.hidden = false;
    } finally {
      this.sending = false;
      this.refreshState();
    }
  }
}
