// Usage strip in the top bar: one card per account (5 h window and week). It measures the room the top bar leaves it
// and adapts: full cards, compact cards (chip and the 5 h figure), or as many compact cards as fit plus a "+N"
// button that opens a popover with all of them.
import { t } from '../../i18n';
import type { AppContext, Component } from '../context';
import { h, setText } from '../dom';
import { fitUsageCards, type UsageFit } from '../model/usage-fit';
import { setPressed } from '../widgets';
import { usageCard, usageEntries, usageSignature } from './usage-card';

export class UsageCards implements Component {
  readonly el = h('div', { class: 'ao-usage', role: 'group', 'aria-label': t('usage.label') });
  private readonly more = h('button', { type: 'button', class: 'ao-usage-more', 'aria-haspopup': 'dialog', hidden: true, onclick: () => this.ctx.togglePopover('usage') });
  private observer: ResizeObserver | null = null;
  private signature = '';

  constructor(private readonly ctx: AppContext) {
    this.more.dataset.popoverTrigger = 'usage';
  }

  render(): void {
    this.observe();
    const popoverOpen = this.ctx.ui.get().popover === 'usage';
    setPressed(this.more, popoverOpen);
    const signature = usageSignature(this.ctx);
    if (signature === this.signature) return;
    this.signature = signature;
    this.el.replaceChildren(...usageEntries(this.ctx).map(({ accountId, usage }) => usageCard(this.ctx, accountId, usage)), this.more);
    this.fit();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Re-fits whenever the top bar group or one of its other children (the counters) changes size. */
  private observe(): void {
    const parent = this.el.parentElement;
    if (this.observer || !parent) return;
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(parent);
    for (const child of Array.from(parent.children)) if (child !== this.el) this.observer.observe(child);
  }

  private cards(): HTMLElement[] {
    return Array.from(this.el.querySelectorAll<HTMLElement>('.ao-usage-card'));
  }

  /** Room left in the parent group next to its other children. */
  private available(parent: HTMLElement): number {
    const gap = parseFloat(getComputedStyle(parent).columnGap) || 0;
    const others = Array.from(parent.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child !== this.el);
    const used = others.reduce((sum, child) => sum + child.offsetWidth, 0) + gap * others.length;
    return parent.clientWidth - used;
  }

  /** Measures both forms of the cards (and the "+N" button) and fits them into what is left of the group. */
  private measureFit(parent: HTMLElement, cards: readonly HTMLElement[]): UsageFit {
    for (const card of cards) card.hidden = false;
    this.el.hidden = false;
    this.more.hidden = false;
    setText(this.more, `+${cards.length}`);
    this.el.classList.remove('is-compact');
    const full = cards.map((card) => card.offsetWidth);
    this.el.classList.add('is-compact');
    const compact = cards.map((card) => card.offsetWidth);
    const gap = parseFloat(getComputedStyle(this.el).columnGap) || 0;
    return fitUsageCards({ available: this.available(parent), gap, full, compact, more: this.more.offsetWidth });
  }

  /**
   * The counters keep their labels only while the full cards fit next to them; otherwise the labels give way
   * (`is-dense` on the top bar) before the cards shrink or collapse.
   */
  private fit(): void {
    const parent = this.el.parentElement;
    if (!parent) return;
    const cards = this.cards();
    const topbar = this.el.closest('.ao-topbar');
    topbar?.classList.remove('is-dense');
    let result = this.measureFit(parent, cards);
    if (result.compact || result.visible < cards.length) {
      topbar?.classList.add('is-dense');
      result = this.measureFit(parent, cards);
    }

    this.el.classList.toggle('is-compact', result.compact);
    cards.forEach((card, index) => {
      card.hidden = index >= result.visible;
    });
    const left = cards.length - result.visible;
    this.more.hidden = !result.showMore || left === 0;
    // A card folded into "+N" that is about to hit its limit still warns, on the button.
    this.more.classList.toggle('is-warning', !this.more.hidden && cards.some((card, index) => index >= result.visible && card.classList.contains('is-warning')));
    this.el.hidden = result.visible === 0 && this.more.hidden;
    setText(this.more, `+${left}`);
    this.more.setAttribute('aria-label', t('usage.more', { n: left }));
    this.more.title = t('usage.more', { n: left });
    if (this.more.hidden && this.ctx.ui.get().popover === 'usage') this.ctx.closePopover();
  }
}
