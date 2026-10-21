// The limits form of one account: unit, limit per 5 h window and limit per week. Saved in the browser preferences as
// soon as a field is committed; it is built once and only synced afterwards, so typing is never interrupted.
import type { AccountLimits, LimitUnit } from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext } from '../context';
import { h } from '../dom';
import { type LimitField, limitToInput, parseLimitInput, withLimit, withUnit, withoutLimits } from '../model/usage-limits';

const FIELDS: readonly { field: LimitField; label: 'usage.limits.window5h' | 'usage.limits.week' }[] = [
  { field: 'window5h', label: 'usage.limits.window5h' },
  { field: 'week', label: 'usage.limits.week' },
];

let formCounter = 0;

export class UsageLimitsForm {
  readonly el: HTMLElement;
  private readonly unit: HTMLSelectElement;
  private readonly inputs = new Map<LimitField, HTMLInputElement>();
  private readonly suffixes: HTMLElement[] = [];
  private readonly error = h('p', { class: 'ao-usage-limits-error', role: 'alert', hidden: true }, t('usage.limits.invalid'));

  constructor(
    private readonly ctx: AppContext,
    private readonly accountId: string,
  ) {
    const id = `ao-usage-limits-${++formCounter}`;
    this.unit = h(
      'select',
      { class: 'ao-select', id: `${id}-unit`, onchange: () => this.saveUnit() },
      h('option', { value: 'usd' }, t('usage.limits.unit.usd')),
      h('option', { value: 'tokens' }, t('usage.limits.unit.tokens')),
    );
    const fields = FIELDS.map(({ field, label }) => {
      const input = h('input', {
        class: 'ao-input',
        id: `${id}-${field}`,
        type: 'text',
        inputmode: 'decimal',
        autocomplete: 'off',
        placeholder: t('usage.limits.placeholder'),
        onchange: () => this.saveField(field),
      });
      this.inputs.set(field, input);
      const suffix = h('span', { class: 'ao-usage-limits-suffix' });
      this.suffixes.push(suffix);
      return h('div', { class: 'ao-usage-limits-field' }, h('label', { for: input.id }, t(label)), h('div', { class: 'ao-usage-limits-input' }, input, suffix));
    });
    const clear = h('button', { type: 'button', class: 'ao-btn ao-btn--ghost ao-btn--small', onclick: () => this.clear() }, t('usage.limits.clear'));
    this.el = h(
      'details',
      { class: 'ao-usage-limits' },
      h('summary', null, t('usage.limits.title')),
      h('p', { class: 'ao-usage-limits-hint' }, t('usage.limits.hint')),
      h('div', { class: 'ao-usage-limits-grid' }, h('div', { class: 'ao-usage-limits-field' }, h('label', { for: this.unit.id }, t('usage.limits.unit')), this.unit), ...fields),
      this.error,
      h('div', { class: 'ao-usage-limits-actions' }, clear),
    );
    this.sync();
  }

  private current(): AccountLimits | undefined {
    return this.ctx.prefs.get().usageLimits[this.accountId];
  }

  private unitNow(): LimitUnit {
    return this.current()?.unit ?? 'usd';
  }

  /** Shows the saved values, leaving alone the field the user is typing in. */
  sync(): void {
    const limits = this.current();
    const unit = this.unitNow();
    if (document.activeElement !== this.unit) this.unit.value = unit;
    for (const [field, input] of this.inputs) if (document.activeElement !== input) input.value = limitToInput(limits?.[field], unit);
    const suffix = unit === 'usd' ? 'US$' : t('usage.limits.unit.tokens');
    for (const el of this.suffixes) if (el.textContent !== suffix) el.textContent = suffix;
  }

  private save(next: Readonly<Record<string, AccountLimits>>): void {
    this.ctx.prefs.set({ usageLimits: next });
    this.ctx.announce(t('usage.limits.saved'));
    this.sync();
  }

  private saveField(field: LimitField): void {
    const input = this.inputs.get(field) as HTMLInputElement;
    const parsed = parseLimitInput(input.value, this.unitNow());
    this.error.hidden = parsed.kind !== 'invalid';
    input.setAttribute('aria-invalid', String(parsed.kind === 'invalid'));
    if (parsed.kind === 'invalid') return;
    this.save(withLimit(this.ctx.prefs.get().usageLimits, this.accountId, field, parsed.kind === 'value' ? parsed.value : undefined));
  }

  private saveUnit(): void {
    this.error.hidden = true;
    this.save(withUnit(this.ctx.prefs.get().usageLimits, this.accountId, this.unit.value === 'tokens' ? 'tokens' : 'usd'));
  }

  private clear(): void {
    this.error.hidden = true;
    this.save(withoutLimits(this.ctx.prefs.get().usageLimits, this.accountId));
  }
}
