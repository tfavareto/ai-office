// The rule editor of the rules dialog: effect, tool, matcher, scope, note, and the live "would have answered N requests
// today" preview. It is built once; each render only syncs what changed so typing never loses focus.
import type { RuleMatcherKind } from '@ai-office/shared';
import { t, type TextKey } from '../../i18n';
import type { AppContext, Component } from '../context';
import { accountLabel } from '../display';
import { h, setAttr, setText, toggleClass } from '../dom';
import { COMMON_TOOLS, folderName, isFormComplete, kindsFor } from '../model/rules';
import type { PreviewState } from '../rules-controller';
import { explainRejection } from '../rules-text';
import { button, createSegmented, createSwitch } from '../widgets';

const TOOL_LIST_ID = 'ao-rule-tools';

interface Field {
  el: HTMLElement;
  /** The control that receives focus for this field. */
  control: HTMLElement;
}

function field(label: string, control: HTMLElement, hint?: HTMLElement, wide = false): Field {
  const id = control.id;
  return {
    el: h(
      'div',
      { class: wide ? 'ao-rule-field ao-rule-field--wide' : 'ao-rule-field' },
      h('label', { class: 'ao-rule-label', for: id }, label),
      control,
      hint ?? null,
    ),
    control,
  };
}

function syncValue(input: HTMLInputElement | HTMLSelectElement, value: string, force: boolean): void {
  if (input.value !== value && (force || document.activeElement !== input)) input.value = value;
}

export class RuleEditor implements Component {
  readonly el = h('form', { class: 'ao-rule-editor', novalidate: true, hidden: true });
  private readonly title = h('h3', { class: 'ao-rule-editor-title' });
  private readonly source = h('p', { class: 'ao-rule-source', hidden: true });
  private readonly effect = createSegmented(
    t('rules.editor.effect'),
    [
      { value: 'allow', label: t('rules.editor.effect.allow') },
      { value: 'deny', label: t('rules.editor.effect.deny') },
    ] as const,
    (value) => this.ctx.rules.setForm({ effect: value }),
  );
  private readonly tool = h('input', {
    type: 'text',
    id: 'ao-rule-tool',
    class: 'ao-input',
    list: TOOL_LIST_ID,
    autocomplete: 'off',
    spellcheck: 'false',
  });
  private readonly kind = h('select', { id: 'ao-rule-kind', class: 'ao-select' });
  private readonly value = h('input', {
    type: 'text',
    id: 'ao-rule-value',
    class: 'ao-input ao-rule-value',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  private readonly valueField: Field;
  private readonly hint = h('p', { class: 'ao-setting-hint' });
  private readonly project = h('select', { id: 'ao-rule-project', class: 'ao-select' });
  private readonly account = h('select', { id: 'ao-rule-account', class: 'ao-select' });
  private readonly note = h('input', {
    type: 'text',
    id: 'ao-rule-note',
    class: 'ao-input',
    maxlength: 200,
    autocomplete: 'off',
    placeholder: t('rules.editor.note.placeholder'),
  });
  private readonly enabled = createSwitch(t('rules.editor.enabled'), () =>
    this.ctx.rules.setForm({ enabled: !(this.ctx.rules.get().editor?.form.enabled ?? true) }),
  );
  private readonly preview = h('p', { class: 'ao-rule-preview', role: 'status', 'aria-live': 'polite' });
  private readonly refusal = h('p', { class: 'ao-rule-refusal', role: 'alert', hidden: true });
  private readonly saveBtn: HTMLButtonElement;
  private readonly toolsList = h(
    'datalist',
    { id: TOOL_LIST_ID },
    ...COMMON_TOOLS.map((tool) => h('option', { value: tool })),
  );
  private wasOpen = false;
  private kindSignature = '';
  private projectSignature = '';
  private accountSignature = '';

  constructor(private readonly ctx: AppContext) {
    this.valueField = field(t('rules.editor.value'), this.value, this.hint, true);
    this.saveBtn = h(
      'button',
      { type: 'submit', class: 'ao-btn ao-btn--primary' },
      h('span', null, t('rules.editor.save')),
    );
    const back = button({ label: t('rules.editor.back'), variant: 'ghost', onClick: () => ctx.rules.closeEditor() });
    const toolHint = h('p', { class: 'ao-setting-hint' }, t('rules.editor.tool.hint'));
    this.el.append(
      this.title,
      this.source,
      h(
        'div',
        { class: 'ao-rule-field' },
        h('span', { class: 'ao-rule-label' }, t('rules.editor.effect')),
        this.effect.el,
      ),
      field(t('rules.editor.tool'), this.tool, toolHint).el,
      field(t('rules.editor.kind'), this.kind).el,
      this.valueField.el,
      field(t('rules.editor.scope'), this.project).el,
      field(t('rules.editor.account'), this.account).el,
      field(t('rules.editor.note'), this.note, undefined, true).el,
      h(
        'div',
        { class: 'ao-rule-field ao-rule-field--row' },
        h('span', { class: 'ao-rule-label' }, t('rules.editor.enabled')),
        this.enabled.el,
      ),
      this.preview,
      h('p', { class: 'ao-setting-hint ao-rule-safety' }, t('rules.editor.safety')),
      this.refusal,
      h('div', { class: 'ao-rule-actions' }, this.saveBtn, back),
      this.toolsList,
    );
    this.wire();
  }

  private wire(): void {
    const rules = this.ctx.rules;
    this.tool.addEventListener('input', () => rules.setTool(this.tool.value));
    this.kind.addEventListener('change', () => rules.setKind(this.kind.value as RuleMatcherKind));
    this.value.addEventListener('input', () => rules.setForm({ value: this.value.value }));
    this.project.addEventListener('change', () =>
      rules.setForm({ onlyProject: this.project.value !== '', projectPath: this.project.value }),
    );
    this.account.addEventListener('change', () => rules.setForm({ accountId: this.account.value }));
    this.note.addEventListener('input', () => rules.setForm({ note: this.note.value }));
    this.el.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.save();
    });
    this.el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        rules.closeEditor();
      }
    });
  }

  private async save(): Promise<void> {
    const saved = await this.ctx.rules.save();
    if (saved !== null) this.ctx.announce(t('announce.rules.saved'));
  }

  /** Moves focus to the first field (or the one the server complained about). */
  focusFirst(): void {
    const editor = this.ctx.rules.get().editor;
    (editor?.source !== null && editor?.source !== undefined ? this.value : this.tool).focus({ preventScroll: true });
  }

  render(): void {
    const editor = this.ctx.rules.get().editor;
    this.el.hidden = editor === null;
    if (editor === null) {
      this.wasOpen = false;
      return;
    }
    const force = !this.wasOpen;
    const { form } = editor;
    setText(this.title, editor.ruleId === null ? t('rules.new') : t('rules.editor.titleEdit'));
    this.source.hidden = editor.source === null;
    if (editor.source !== null)
      setText(this.source, t('rules.editor.from', { name: editor.source.agentName, summary: editor.source.summary }));
    this.effect.set(form.effect);
    syncValue(this.tool, form.tool, force);
    this.renderKinds(form.tool, form.kind);
    this.valueField.el.hidden = form.kind === 'any';
    syncValue(this.value, form.value, force);
    this.value.placeholder = t(`rules.placeholder.${form.kind}` as TextKey);
    setText(this.hint, t(`rules.hint.${form.kind}` as TextKey));
    this.renderProjects(form.projectPath);
    syncValue(this.project, form.onlyProject ? form.projectPath : '', force);
    this.renderAccounts();
    syncValue(this.account, form.accountId, force);
    syncValue(this.note, form.note, force);
    this.enabled.set(form.enabled);
    this.renderPreview(editor.refusal === null ? editor.preview : { status: 'idle' });
    this.renderRefusal(editor.refusal === null ? null : explainRejection(editor.refusal), editor.failure);
    this.saveBtn.disabled = editor.saving || !isFormComplete(form);
    setText(
      this.saveBtn.firstElementChild as HTMLElement,
      editor.saving ? t('rules.editor.saving') : t('rules.editor.save'),
    );
    if (!this.wasOpen) {
      this.wasOpen = true;
      queueMicrotask(() => this.focusFirst());
    }
  }

  private renderKinds(tool: string, current: RuleMatcherKind): void {
    const kinds = kindsFor(tool);
    const signature = kinds.join('|');
    if (signature !== this.kindSignature) {
      this.kindSignature = signature;
      this.kind.replaceChildren(
        ...kinds.map((kind) => h('option', { value: kind }, t(`rules.kind.${kind}` as TextKey))),
      );
    }
    syncValue(this.kind, current, true);
  }

  private renderProjects(selectedPath: string): void {
    const projects = (this.ctx.snapshot?.projects ?? []).map((project) => ({ path: project.path, name: project.name }));
    if (selectedPath !== '' && !projects.some((project) => project.path === selectedPath))
      projects.push({ path: selectedPath, name: folderName(selectedPath) });
    const signature = projects.map((project) => project.path).join('|');
    if (signature === this.projectSignature) return;
    this.projectSignature = signature;
    this.project.replaceChildren(
      h('option', { value: '' }, t('rules.scope.all')),
      ...projects.map((project) =>
        h('option', { value: project.path }, t('rules.scope.project', { name: project.name })),
      ),
    );
  }

  private renderAccounts(): void {
    const accounts = this.ctx.snapshot?.accounts ?? [];
    const signature = accounts.map((account) => `${account.id}:${account.label}`).join('|');
    if (signature === this.accountSignature) return;
    this.accountSignature = signature;
    this.account.replaceChildren(
      h('option', { value: '' }, t('rules.editor.account.all')),
      ...accounts.map((account) => h('option', { value: account.id }, accountLabel(account))),
    );
  }

  private renderPreview(preview: PreviewState): void {
    toggleClass(this.preview, 'is-warn', preview.status === 'refused' || preview.status === 'failed');
    this.preview.hidden = preview.status === 'idle';
    switch (preview.status) {
      case 'idle':
        return;
      case 'loading':
        setText(this.preview, t('rules.preview.loading'));
        return;
      case 'ready':
        setText(
          this.preview,
          preview.preview.total === 0
            ? t('rules.preview.none')
            : t('rules.preview.result', { matches: preview.preview.matches, total: preview.preview.total }),
        );
        return;
      case 'refused':
        setText(this.preview, explainRejection(preview.rejection));
        return;
      case 'failed':
        setText(this.preview, t('rules.preview.failed'));
        return;
    }
  }

  private renderRefusal(refusal: string | null, failure: string | null): void {
    const text = refusal ?? (failure !== null ? t('rules.error.saveFailed') : '');
    const appearing = this.refusal.hidden && text !== '';
    this.refusal.hidden = text === '';
    setText(this.refusal, text);
    if (appearing) this.refusal.scrollIntoView({ block: 'nearest' });
    setAttr(this.refusal, 'title', refusal === null ? failure : null);
  }
}
