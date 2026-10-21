// "Regras de aprovação": teach the office to answer recurring permission requests. Two tabs (the rules, and the log of
// what they decided), and an editor that takes over the dialog while a rule is being written.
import { t } from '../../i18n';
import { type AppContext, localOnlyHint } from '../context';
import { h, setText, toggleClass } from '../dom';
import { type RulesTab } from '../rules-controller';
import { button, createSegmented } from '../widgets';
import { Dialog, closeButton } from './overlay';
import { RuleEditor } from './rules-editor';
import { RulesList } from './rules-list';
import { RulesLog } from './rules-log';

const PRESET_NEW_RULE = { effect: 'allow', tool: 'Bash', matcher: { kind: 'command-prefix', value: '' }, scope: {}, enabled: true } as const;

export class RulesDialog extends Dialog {
  private readonly tabs = createSegmented<RulesTab>(
    t('rules.tabs'),
    [
      { value: 'rules', label: t('rules.tab.rules') },
      { value: 'log', label: t('rules.tab.log') },
    ],
    (tab) => this.ctx.rules.setTab(tab),
  );
  private readonly toolbar: HTMLElement;
  private readonly newBtn: HTMLButtonElement;
  private readonly status = h('div', { class: 'ao-rules-status', hidden: true });
  private readonly statusText = h('p', { class: 'ao-note' });
  private readonly retryBtn: HTMLButtonElement;
  private readonly list: RulesList;
  private readonly log: RulesLog;
  private readonly editor: RuleEditor;
  private readonly body = h('div', { class: 'ao-rules-body' });
  private wasRulesOpen = false;

  constructor(app: AppContext) {
    super(app, 'rules', 'ao-rules-title', 'ao-dialog--rules');
    this.list = new RulesList(app);
    this.log = new RulesLog(app);
    this.editor = new RuleEditor(app);
    this.newBtn = button({ label: t('rules.new'), icon: 'plus', variant: 'primary', className: 'ao-btn--small', onClick: () => app.rules.startNew(PRESET_NEW_RULE) });
    this.toolbar = h('div', { class: 'ao-rules-toolbar' }, this.tabs.el, h('span', { class: 'ao-inbox-spacer' }), this.newBtn);
    this.retryBtn = button({ label: t('common.retry'), variant: 'soft', className: 'ao-btn--small', onClick: () => void app.rules.load() });
    this.status.append(this.statusText, this.retryBtn);
    this.body.append(this.status, this.list.el, this.log.el, this.editor.el);
    this.panel.append(
      h('header', { class: 'ao-dialog-head' }, h('h2', { id: 'ao-rules-title' }, t('rules.title')), closeButton(t('common.close'), () => app.closeDialog())),
      this.toolbar,
      this.body,
    );
  }

  protected onOpen(): void {
    // The controller was started by whoever opened the dialog (settings, inbox, "Criar regra…").
  }

  override render(): void {
    const open = this.ctx.ui.get().dialog === 'rules';
    if (this.wasRulesOpen && !open) this.ctx.rules.stop();
    this.wasRulesOpen = open;
    super.render();
  }

  protected update(): void {
    const state = this.ctx.rules.get();
    const editing = state.editor !== null;
    const local = this.ctx.isLocal;
    this.tabs.set(state.tab);
    this.toolbar.hidden = editing;
    this.newBtn.disabled = !local;
    this.status.hidden = editing || (local && state.status !== 'error' && state.status !== 'loading');
    setText(this.statusText, !local ? localOnlyHint() : state.status === 'error' ? state.error : t('rules.loading'));
    this.retryBtn.hidden = !local || state.status !== 'error';
    const ready = local && state.status === 'ready' && !editing;
    this.list.el.hidden = !(ready && state.tab === 'rules');
    this.log.el.hidden = !(ready && state.tab === 'log');
    if (!this.list.el.hidden) this.list.render();
    if (!this.log.el.hidden) this.log.render();
    this.editor.render();
    toggleClass(this.panel, 'is-editing', editing);
  }
}
