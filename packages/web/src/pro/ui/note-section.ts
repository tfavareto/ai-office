// The note of a room, in its panel: what everyone working in the project shares. Agents in real terminals read it and add
// lines to it, so saving is refused if it changed since it was read, instead of erasing what they wrote.
import { t, type TextKey } from '../../i18n';
import { BackendError, describeError } from '../../net/backend';
import type { AppContext } from '../../ui/context';
import { h, setText } from '../../ui/dom';

const ERROR_KEY: Readonly<Record<string, TextKey>> = {
  'note-changed': 'pro.note.changed',
  'note-too-long': 'pro.note.tooLong',
  'too-many-notes': 'pro.note.tooMany',
  demo: 'pro.note.demo',
};

export class NoteSection {
  readonly el = h('section', { class: 'ao-pro-floor', hidden: true });
  private readonly text = h('textarea', {
    class: 'ao-textarea ao-pro-note-text',
    rows: 5,
    'aria-label': t('pro.note.title'),
  });
  private readonly status = h('p', { class: 'ao-pro-floor-note', 'aria-live': 'polite' });
  private roomId: string | null = null;
  private base = 0;

  constructor(private readonly ctx: AppContext) {
    this.el.append(
      h('h3', { class: 'ao-pro-panel-h' }, t('pro.note.title')),
      h('p', { class: 'ao-pro-floor-note' }, t('pro.note.hint')),
      this.text,
      h(
        'div',
        { class: 'ao-pro-floor-actions' },
        h(
          'button',
          { type: 'button', class: 'ao-btn ao-btn--soft', onclick: () => void this.save() },
          t('pro.note.save'),
        ),
        h(
          'button',
          { type: 'button', class: 'ao-btn ao-btn--ghost', onclick: () => void this.load() },
          t('pro.note.reload'),
        ),
      ),
      this.status,
    );
  }

  show(roomId: string): void {
    this.roomId = roomId;
    this.el.hidden = !this.ctx.isLocal;
    this.text.value = '';
    this.base = 0;
    setText(this.status, '');
    void this.load();
  }

  private async load(): Promise<void> {
    const roomId = this.roomId;
    if (roomId === null || !this.ctx.isLocal) return;
    try {
      const note = await this.ctx.store.backend.note(roomId);
      if (roomId !== this.roomId) return;
      this.text.value = note.text;
      this.base = note.updatedAt;
      setText(this.status, '');
    } catch (error) {
      if (roomId === this.roomId) setText(this.status, describeError(error));
    }
  }

  private async save(): Promise<void> {
    const roomId = this.roomId;
    if (roomId === null) return;
    try {
      const note = await this.ctx.store.backend.saveNote(roomId, this.text.value, this.base);
      if (roomId !== this.roomId) return;
      this.base = note.updatedAt;
      setText(this.status, t('pro.note.saved'));
    } catch (error) {
      if (roomId !== this.roomId) return;
      const key = error instanceof BackendError ? ERROR_KEY[error.message] : undefined;
      setText(this.status, key !== undefined ? t(key) : describeError(error));
    }
  }
}
