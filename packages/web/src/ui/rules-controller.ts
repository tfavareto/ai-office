// State of the approval rules screens: the rules and the auto-decision log as the server has them, the editor (a form
// plus the live "would have answered N requests today" preview) and the log filters. Talks to the backend, nothing else.
import type { AutoDecision, Rule, RuleDraft, RuleErrorBody, RuleMatcherKind, RulePreview } from '@ai-office/shared';
import { RuleRejectedError, describeError, type Backend } from '../net/backend';
import {
  EMPTY_FILTER,
  draftFromForm,
  formFromDraft,
  isFormComplete,
  withKind,
  withTool,
  type LogFilter,
  type RuleForm,
} from './model/rules';
import { Observable } from './observable';

export type RulesTab = 'rules' | 'log';
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Where a suggested rule came from, shown in the editor ("from Ana's request: npm test"). */
export interface RuleSource {
  agentName: string;
  summary: string;
}

export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; preview: RulePreview }
  | { status: 'refused'; rejection: RuleErrorBody }
  | { status: 'failed' };

export interface EditorData {
  /** The rule being edited; null for a new one. */
  ruleId: string | null;
  form: RuleForm;
  source: RuleSource | null;
  preview: PreviewState;
  /** Why the last save failed: the server's explanation of a refused rule, or a plain message. */
  refusal: RuleErrorBody | null;
  failure: string | null;
  saving: boolean;
}

export interface RulesData {
  status: LoadStatus;
  error: string;
  rules: readonly Rule[];
  log: readonly AutoDecision[];
  tab: RulesTab;
  filter: LogFilter;
  editor: EditorData | null;
  /** Rule whose deletion waits for confirmation. */
  confirmDelete: string | null;
  /** A toggle, delete or clear is being sent. */
  busy: boolean;
}

/** Outcome of a list action; a refused rule carries the server's explanation. */
export type ActionResult = { ok: true } | { ok: false; message: string; rejection?: RuleErrorBody };

export const PREVIEW_DELAY_MS = 350;
export const REFRESH_MS = 5000;

const INITIAL: RulesData = {
  status: 'idle',
  error: '',
  rules: [],
  log: [],
  tab: 'rules',
  filter: EMPTY_FILTER,
  editor: null,
  confirmDelete: null,
  busy: false,
};

export class RulesController extends Observable<RulesData> {
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private previewToken = 0;
  private loadToken = 0;

  constructor(private readonly backend: () => Backend) {
    super(INITIAL);
  }

  private patch(change: Partial<RulesData>): void {
    this.replace({ ...this.value, ...change });
  }

  private patchEditor(change: Partial<EditorData>): void {
    if (this.value.editor === null) return;
    this.patch({ editor: { ...this.value.editor, ...change } });
  }

  // --- loading -------------------------------------------------------------------------------------------------------

  /** Loads rules and log. `quiet` keeps the current lists on screen while it refreshes. */
  async load(quiet = false): Promise<void> {
    const token = ++this.loadToken;
    if (!quiet) this.patch({ status: 'loading', error: '' });
    try {
      const [rules, log] = await Promise.all([this.backend().rules(), this.backend().ruleLog()]);
      if (token !== this.loadToken) return;
      this.patch({ status: 'ready', error: '', rules, log });
    } catch (error) {
      if (token !== this.loadToken) return;
      if (quiet && this.value.status === 'ready') return;
      this.patch({ status: 'error', error: describeError(error) });
    }
  }

  /** Called when the dialog opens: loads, then keeps the hit counters and the log fresh while it stays open. */
  start(tab: RulesTab = this.value.tab): void {
    this.patch({ tab, confirmDelete: null });
    void this.load();
    this.stopRefreshing();
    this.refreshTimer = setInterval(() => {
      if (this.value.editor === null && !this.value.busy) void this.load(true);
    }, REFRESH_MS);
  }

  stop(): void {
    this.stopRefreshing();
    this.clearPreviewTimer();
    this.patch({ editor: null, confirmDelete: null, busy: false });
  }

  private stopRefreshing(): void {
    if (this.refreshTimer !== undefined) clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  setTab(tab: RulesTab): void {
    this.patch({ tab });
  }

  setFilter(change: Partial<LogFilter>): void {
    this.patch({ filter: { ...this.value.filter, ...change } });
  }

  /** Shows the log of one rule. */
  showLogOf(ruleId: string): void {
    this.patch({ tab: 'log', filter: { ...EMPTY_FILTER, ruleId } });
  }

  // --- editor --------------------------------------------------------------------------------------------------------

  startNew(draft: RuleDraft, source: RuleSource | null = null): void {
    this.openEditor({ ruleId: null, form: formFromDraft(draft), source });
  }

  startEdit(rule: Rule): void {
    this.openEditor({ ruleId: rule.id, form: formFromDraft(rule), source: null });
  }

  private openEditor(base: Pick<EditorData, 'ruleId' | 'form' | 'source'>): void {
    this.patch({
      editor: { ...base, preview: { status: 'idle' }, refusal: null, failure: null, saving: false },
      confirmDelete: null,
    });
    this.schedulePreview(0);
  }

  closeEditor(): void {
    this.clearPreviewTimer();
    this.previewToken++;
    this.patch({ editor: null });
  }

  /** Changes form fields; the preview follows after a short pause. */
  setForm(change: Partial<RuleForm>): void {
    const editor = this.value.editor;
    if (editor === null) return;
    this.patchEditor({ form: { ...editor.form, ...change }, refusal: null, failure: null });
    this.schedulePreview(PREVIEW_DELAY_MS);
  }

  setTool(tool: string): void {
    const editor = this.value.editor;
    if (editor === null) return;
    this.patchEditor({ form: withTool(editor.form, tool), refusal: null, failure: null });
    this.schedulePreview(PREVIEW_DELAY_MS);
  }

  setKind(kind: RuleMatcherKind): void {
    const editor = this.value.editor;
    if (editor === null) return;
    this.patchEditor({ form: withKind(editor.form, kind), refusal: null, failure: null });
    this.schedulePreview(PREVIEW_DELAY_MS);
  }

  private clearPreviewTimer(): void {
    if (this.previewTimer !== undefined) clearTimeout(this.previewTimer);
    this.previewTimer = undefined;
  }

  private schedulePreview(delay: number): void {
    this.clearPreviewTimer();
    const editor = this.value.editor;
    if (editor === null) return;
    if (!isFormComplete(editor.form)) {
      this.previewToken++;
      this.patchEditor({ preview: { status: 'idle' } });
      return;
    }
    this.previewTimer = setTimeout(() => void this.runPreview(), delay);
  }

  private async runPreview(): Promise<void> {
    const editor = this.value.editor;
    if (editor === null) return;
    const token = ++this.previewToken;
    this.patchEditor({ preview: { status: 'loading' } });
    try {
      const preview = await this.backend().previewRule(draftFromForm(editor.form));
      if (token === this.previewToken) this.patchEditor({ preview: { status: 'ready', preview } });
    } catch (error) {
      if (token !== this.previewToken) return;
      this.patchEditor({
        preview:
          error instanceof RuleRejectedError ? { status: 'refused', rejection: error.rejection } : { status: 'failed' },
      });
    }
  }

  /** Sends the form. Returns the saved rule, or null (the editor then says why). */
  async save(): Promise<Rule | null> {
    const editor = this.value.editor;
    if (editor === null || editor.saving || !isFormComplete(editor.form)) return null;
    this.patchEditor({ saving: true, refusal: null, failure: null });
    const draft = draftFromForm(editor.form);
    try {
      const saved =
        editor.ruleId === null
          ? await this.backend().createRule(draft)
          : await this.backend().updateRule(editor.ruleId, { ...draft, note: draft.note ?? null });
      this.clearPreviewTimer();
      this.previewToken++;
      this.patch({ editor: null, tab: 'rules' });
      await this.load(true);
      return saved;
    } catch (error) {
      if (error instanceof RuleRejectedError) this.patchEditor({ saving: false, refusal: error.rejection });
      else this.patchEditor({ saving: false, failure: describeError(error) });
      return null;
    }
  }

  // --- list actions --------------------------------------------------------------------------------------------------

  /** Turns a rule on or off. Returns false when it could not be saved (for example a stored rule the policy refuses). */
  async toggle(rule: Rule): Promise<ActionResult> {
    return this.run(async () => {
      const updated = await this.backend().updateRule(rule.id, { enabled: !rule.enabled });
      this.patch({ rules: this.value.rules.map((candidate) => (candidate.id === rule.id ? updated : candidate)) });
    });
  }

  askDelete(ruleId: string | null): void {
    this.patch({ confirmDelete: ruleId });
  }

  async remove(ruleId: string): Promise<ActionResult> {
    const result = await this.run(async () => {
      await this.backend().deleteRule(ruleId);
      this.patch({ rules: this.value.rules.filter((rule) => rule.id !== ruleId) });
    });
    this.patch({ confirmDelete: null });
    return result;
  }

  async clearLog(): Promise<ActionResult> {
    return this.run(async () => {
      await this.backend().clearRuleLog();
      this.patch({ log: [] });
    });
  }

  private async run(action: () => Promise<void>): Promise<ActionResult> {
    if (this.value.busy) return { ok: false, message: '' };
    this.patch({ busy: true });
    try {
      await action();
      return { ok: true };
    } catch (error) {
      return error instanceof RuleRejectedError
        ? { ok: false, message: '', rejection: error.rejection }
        : { ok: false, message: describeError(error) };
    } finally {
      this.patch({ busy: false });
    }
  }
}
