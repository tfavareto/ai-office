// Popover behind the "+N" button of the top bar: every account's usage card, in full.
import { t } from '../../i18n';
import type { AppContext } from '../context';
import { h } from '../dom';
import { usageCard, usageEntries, usageSignature } from './usage-card';
import { Popover } from './overlay';

export class UsagePopover extends Popover {
  private readonly list = h('div', { class: 'ao-usage-list' });
  private signature = '';

  constructor(ctx: AppContext) {
    super(ctx, 'usage', t('usage.label'), 'ao-popover--usage');
    this.el.append(h('header', { class: 'ao-popover-head' }, h('strong', null, t('usage.label'))), this.list);
  }

  protected onOpen(): void {
    this.signature = '';
  }

  protected update(): void {
    const signature = usageSignature(this.ctx);
    if (signature === this.signature) return;
    this.signature = signature;
    this.list.replaceChildren(
      ...usageEntries(this.ctx).map(({ accountId, usage }) => usageCard(this.ctx, accountId, usage, true)),
    );
  }
}
