// The "Regras" tab: one row per rule with its effect, what it covers, where it applies, how often it fired, and the
// actions (switch, see log, edit, delete with a confirmation step).
import type { Rule } from '@ai-office/shared';
import { t, type TextKey } from '../../i18n';
import type { AppContext, Component } from '../context';
import { KeyedList, h, setAttr, setText, toggleClass, type KeyedEntry } from '../dom';
import { formatAgo } from '../format';
import { icon } from '../icons';
import { sortRules } from '../model/rules';
import { effectLabel, explainRejection, matcherValueText, ruleLabel, scopeText } from '../rules-text';
import { button, createSwitch } from '../widgets';

interface RowModel {
  rule: Rule;
  confirming: boolean;
}

class RuleRow {
  private readonly el = h('li', { class: 'ao-rule-row' });
  private readonly badge = h('span', { class: 'ao-rule-badge' });
  private readonly tool = h('span', { class: 'ao-tool-chip' });
  private readonly kind = h('span', { class: 'ao-rule-kind' });
  private readonly value = h('code', { class: 'ao-rule-matcher' });
  private readonly scope = h('span', { class: 'ao-rule-scope' });
  private readonly hits = h('span', { class: 'ao-rule-hits' });
  private readonly note = h('p', { class: 'ao-rule-note', hidden: true });
  private readonly toggle = createSwitch(t('rules.enabled'), () => void this.onToggle());
  private readonly actions = h('div', { class: 'ao-rule-row-actions' });
  private readonly confirm = h('div', { class: 'ao-rule-confirm', role: 'alert', hidden: true });
  private model: RowModel;

  constructor(
    private readonly ctx: AppContext,
    initial: RowModel,
  ) {
    this.model = initial;
    this.el.dataset.id = initial.rule.id;
    const logBtn = button({
      label: t('rules.action.log'),
      variant: 'ghost',
      className: 'ao-btn--small',
      onClick: () => ctx.rules.showLogOf(this.model.rule.id),
    });
    const editBtn = button({
      label: t('rules.action.edit'),
      variant: 'soft',
      className: 'ao-btn--small',
      onClick: () => ctx.rules.startEdit(this.model.rule),
    });
    const deleteBtn = button({
      label: t('rules.action.delete'),
      icon: 'trash',
      variant: 'ghost',
      className: 'ao-btn--small',
      onClick: () => ctx.rules.askDelete(this.model.rule.id),
    });
    this.actions.append(logBtn, editBtn, deleteBtn);
    this.confirm.append(
      h('span', null, t('rules.delete.confirm')),
      button({
        label: t('rules.delete.yes'),
        variant: 'danger',
        className: 'ao-btn--small',
        onClick: () => void this.onDelete(),
      }),
      button({
        label: t('common.cancel'),
        variant: 'ghost',
        className: 'ao-btn--small',
        onClick: () => ctx.rules.askDelete(null),
      }),
    );
    this.el.append(
      h(
        'div',
        { class: 'ao-rule-main' },
        h('div', { class: 'ao-rule-head' }, this.badge, this.tool, this.kind, this.value),
        h('div', { class: 'ao-rule-meta' }, this.scope, this.hits),
        this.note,
      ),
      h('div', { class: 'ao-rule-side' }, this.toggle.el, this.actions),
      this.confirm,
    );
  }

  entry(): KeyedEntry<RowModel> {
    return { el: this.el, update: (model) => this.update(model) };
  }

  private update(model: RowModel): void {
    this.model = model;
    const { rule } = model;
    const accounts = this.ctx.snapshot?.accounts ?? [];
    setText(this.badge, effectLabel(rule.effect));
    this.badge.className = `ao-rule-badge ao-rule-badge--${rule.effect}`;
    setText(this.tool, rule.tool);
    setText(this.kind, rule.matcher.kind === 'any' ? '' : t(`rules.kind.${rule.matcher.kind}` as TextKey));
    setText(this.value, matcherValueText(rule.matcher));
    setText(this.scope, scopeText(rule.scope, accounts));
    const used =
      rule.lastHitAt === undefined
        ? ''
        : ` · ${t('rules.lastHit', { when: formatAgo(this.ctx.now() - rule.lastHitAt) })}`;
    setText(this.hits, `${t('rules.hits', { n: rule.hits })}${used}`);
    this.note.hidden = rule.note === undefined;
    setText(this.note, rule.note ?? '');
    this.toggle.set(rule.enabled);
    setAttr(this.toggle.el, 'aria-label', t('rules.toggle', { rule: ruleLabel(rule) }));
    this.toggle.el.disabled = this.ctx.rules.get().busy;
    toggleClass(this.el, 'is-off', !rule.enabled);
    this.confirm.hidden = !model.confirming;
    this.actions.hidden = model.confirming;
  }

  private async onToggle(): Promise<void> {
    const rule = this.model.rule;
    const result = await this.ctx.rules.toggle(rule);
    if (result.ok) this.ctx.announce(t(rule.enabled ? 'announce.rules.disabled' : 'announce.rules.enabled'));
    else
      this.ctx.notifyLocal(
        'warn',
        result.rejection !== undefined ? explainRejection(result.rejection) : result.message,
      );
  }

  private async onDelete(): Promise<void> {
    const result = await this.ctx.rules.remove(this.model.rule.id);
    if (result.ok) this.ctx.announce(t('announce.rules.deleted'));
    else this.ctx.notifyLocal('warn', result.message);
  }
}

export class RulesList implements Component {
  readonly el = h('div', { class: 'ao-rules-list-wrap' });
  private readonly list = h('ul', { class: 'ao-rules-list', 'aria-label': t('rules.list') });
  private readonly empty: HTMLElement;
  private readonly rows: KeyedList<RowModel>;

  constructor(private readonly ctx: AppContext) {
    this.rows = new KeyedList(
      this.list,
      (model) => model.rule.id,
      (model) => new RuleRow(ctx, model).entry(),
    );
    this.empty = h(
      'div',
      { class: 'ao-rules-empty', hidden: true },
      h('span', { class: 'ao-rules-empty-art', 'aria-hidden': 'true' }, icon('shield', 34)),
      h('strong', null, t('rules.empty.title')),
      h('p', { class: 'ao-note' }, t('rules.empty.text')),
      button({
        label: t('rules.empty.action'),
        icon: 'plus',
        variant: 'primary',
        onClick: () =>
          ctx.rules.startNew({
            effect: 'allow',
            tool: 'Bash',
            matcher: { kind: 'command-prefix', value: '' },
            scope: {},
            enabled: true,
          }),
      }),
    );
    this.el.append(this.empty, this.list);
  }

  render(): void {
    const { rules, confirmDelete } = this.ctx.rules.get();
    this.empty.hidden = rules.length > 0;
    this.list.hidden = rules.length === 0;
    this.rows.sync(sortRules(rules).map((rule) => ({ rule, confirming: confirmDelete === rule.id })));
  }
}
