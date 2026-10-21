// Stacked bars of the tokens over time (inline SVG, no chart library). Every bar is focusable and has a tooltip with the
// exact numbers; the token types differ by fill pattern as well as by color, and the legend names them.
import type { UsageDetail, UsageSeriesPoint } from '@ai-office/shared';
import { t } from '../../i18n';
import { compact, h, svg } from '../dom';
import { formatCost, formatDateLong, formatDayNumber, formatDayShort, formatHourLabel, formatInteger, formatTokens } from '../format';
import { type ChartBar, type ChartModel, type TokenKind, STACK_ORDER, buildChart } from '../model/usage-chart';

const HEIGHT = 224;
const HEIGHT_NARROW = 184;
const NARROW_WIDTH = 520;
const MIN_LABEL_SPACE = 46;
const TOOLTIP_GAP = 10;
const KIND_LABEL = { input: 'usage.kind.input', output: 'usage.kind.output', cacheWrite: 'usage.kind.cacheWrite', cacheRead: 'usage.kind.cacheRead' } as const;

let chartCounter = 0;

/** The text of a bucket: "14h" / "ter. 21" for the axis, the long form for the tooltip. */
function axisLabel(point: UsageSeriesPoint, detail: Pick<UsageDetail, 'granularity' | 'period'>): string {
  if (detail.granularity === 'hour') return formatHourLabel(point.start);
  return detail.period === 'week' ? formatDayShort(point.start) : formatDayNumber(point.start);
}

function whenLabel(point: UsageSeriesPoint, detail: Pick<UsageDetail, 'granularity'>): string {
  return detail.granularity === 'hour' ? `${formatDateLong(point.start)}, ${formatHourLabel(point.start)}` : formatDateLong(point.start);
}

/** Legend entries: a swatch that carries the same fill as the bars, then the name. */
export function chartLegend(kinds: readonly TokenKind[], idPrefix = 'legend'): HTMLElement {
  return h(
    'ul',
    { class: 'ao-usage-legend' },
    ...[...kinds].reverse().map((kind) => {
      const swatch = svg('svg', { class: 'ao-usage-swatch', width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' }, patternDefs(`${idPrefix}-${kind}`, kind), svg('rect', { x: 0, y: 0, width: 14, height: 14, rx: 3, class: `ao-usage-seg ao-usage-seg--${kind}`, fill: `url(#${idPrefix}-${kind}-fill)` }));
      return h('li', null, swatch, h('span', null, t(KIND_LABEL[kind])));
    }),
  );
}

/** One `<defs>` with the fill of a token type: a flat color, hatched lines (cache writes) or dots (cache reads). */
function patternDefs(id: string, kind: TokenKind): SVGDefsElement {
  const defs = svg('defs');
  const pattern = svg('pattern', { id: `${id}-fill`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pattern.appendChild(svg('rect', { width: 6, height: 6, class: `ao-usage-fill ao-usage-fill--${kind}` }));
  if (kind === 'cacheWrite') pattern.appendChild(svg('rect', { width: 2, height: 6, class: 'ao-usage-hatch' }));
  if (kind === 'cacheRead') pattern.appendChild(svg('circle', { cx: 3, cy: 3, r: 1, class: 'ao-usage-hatch' }));
  defs.appendChild(pattern);
  return defs;
}

export class UsageChart {
  readonly el = h('div', { class: 'ao-usage-chart' });
  private readonly tooltip = h('div', { class: 'ao-usage-tooltip', role: 'status', hidden: true });
  private readonly id = `ao-usage-chart-${++chartCounter}`;
  private observer: ResizeObserver | null = null;
  private detail: UsageDetail | null = null;
  private includeCache = false;
  private now = 0;
  private width = 0;

  constructor() {
    this.el.append(this.tooltip);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.onResize());
      this.observer.observe(this.el);
    }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Redraws for new data. */
  set(detail: UsageDetail, includeCache: boolean, now: number): void {
    this.detail = detail;
    this.includeCache = includeCache;
    this.now = now;
    this.draw();
  }

  private onResize(): void {
    const width = Math.floor(this.el.clientWidth);
    if (width === this.width || width <= 0) return;
    this.draw();
  }

  private draw(): void {
    const detail = this.detail;
    if (detail === null) return;
    this.width = Math.max(280, Math.floor(this.el.clientWidth) || 760);
    const height = this.width < NARROW_WIDTH ? HEIGHT_NARROW : HEIGHT;
    const model = buildChart(detail.series, this.now, { width: this.width, height, includeCacheRead: this.includeCache });
    this.hideTooltip();
    this.el.replaceChildren(model.empty ? this.emptyNote() : this.render(detail, model), this.tooltip);
  }

  private emptyNote(): HTMLElement {
    return h('p', { class: 'ao-usage-chart-empty' }, t('usage.chart.empty'));
  }

  private render(detail: UsageDetail, model: ChartModel): SVGSVGElement {
    const titleId = `${this.id}-title`;
    const descId = `${this.id}-desc`;
    const peak = model.bars.reduce((best, bar) => (bar.total > best.total ? bar : best), model.bars[0] as ChartBar);
    const chart = svg('svg', { class: 'ao-usage-svg', width: model.width, height: model.height, viewBox: `0 0 ${model.width} ${model.height}`, role: 'group', 'aria-labelledby': titleId, 'aria-describedby': descId });
    chart.append(
      svg('title', { id: titleId }, document.createTextNode(t(detail.granularity === 'hour' ? 'usage.chart.title.hour' : 'usage.chart.title.day'))),
      svg(
        'desc',
        { id: descId },
        document.createTextNode(
          t(detail.granularity === 'hour' ? 'usage.chart.summary.hour' : 'usage.chart.summary.day', { total: formatInteger(model.bars.reduce((sum, bar) => sum + bar.total, 0)), buckets: model.bars.length, peak: formatInteger(peak.total), when: whenLabel(peak.point, detail) }),
        ),
      ),
    );
    for (const kind of STACK_ORDER) chart.appendChild(patternDefs(`${this.id}-${kind}`, kind));
    chart.appendChild(this.grid(model));
    chart.appendChild(this.axisLabels(model, detail));
    const bars = svg('g', { class: 'ao-usage-bars' });
    const focusIndex = this.initialFocus(model);
    for (const bar of model.bars) bars.appendChild(this.barNode(bar, detail, model, bar.index === focusIndex));
    chart.appendChild(bars);
    return chart;
  }

  private initialFocus(model: ChartModel): number {
    for (let i = model.bars.length - 1; i >= 0; i--) if (!(model.bars[i] as ChartBar).future && (model.bars[i] as ChartBar).total > 0) return i;
    return 0;
  }

  private grid(model: ChartModel): SVGGElement {
    const group = svg('g', { class: 'ao-usage-grid', 'aria-hidden': 'true' });
    for (const tick of model.ticks) {
      group.appendChild(svg('line', { x1: model.plot.left, x2: model.plot.left + model.plot.width, y1: tick.y, y2: tick.y, class: tick.value === 0 ? 'ao-usage-axis' : 'ao-usage-gridline' }));
      const label = svg('text', { x: model.plot.left - 8, y: tick.y + 4, 'text-anchor': 'end', class: 'ao-usage-tick' });
      label.textContent = formatTokens(tick.value);
      group.appendChild(label);
    }
    return group;
  }

  private axisLabels(model: ChartModel, detail: UsageDetail): SVGGElement {
    const group = svg('g', { class: 'ao-usage-xlabels', 'aria-hidden': 'true' });
    const slot = model.bars.length === 0 ? 0 : model.plot.width / model.bars.length;
    const every = Math.max(1, Math.ceil(MIN_LABEL_SPACE / Math.max(1, slot)));
    for (const bar of model.bars) {
      if (bar.index % every !== 0) continue;
      const label = svg('text', { x: bar.x + bar.width / 2, y: model.plot.top + model.plot.height + 16, 'text-anchor': 'middle', class: 'ao-usage-tick' });
      label.textContent = axisLabel(bar.point, detail);
      group.appendChild(label);
    }
    return group;
  }

  private barNode(bar: ChartBar, detail: UsageDetail, model: ChartModel, tabbable: boolean): SVGGElement {
    const slot = model.plot.width / model.bars.length;
    const point = bar.point;
    const group = svg('g', { class: bar.future ? 'ao-usage-bar is-future' : 'ao-usage-bar', tabindex: tabbable ? 0 : -1, role: 'img', 'aria-label': this.barLabel(bar, detail), 'data-index': bar.index });
    group.appendChild(svg('rect', { x: model.plot.left + bar.index * slot, y: model.plot.top, width: slot, height: model.plot.height, class: 'ao-usage-hit' }));
    for (const segment of bar.segments) {
      group.appendChild(svg('rect', { x: bar.x, y: segment.y, width: bar.width, height: segment.height, rx: 1.5, class: `ao-usage-seg ao-usage-seg--${segment.kind}`, fill: `url(#${this.id}-${segment.kind}-fill)` }));
    }
    if (bar.segments.length === 0) group.appendChild(svg('rect', { x: bar.x, y: model.plot.top + model.plot.height - 1, width: bar.width, height: 1, class: 'ao-usage-stub' }));
    group.addEventListener('pointerenter', () => this.showTooltip(bar, detail, model));
    group.addEventListener('pointerleave', () => this.hideTooltip());
    group.addEventListener('focus', () => this.showTooltip(bar, detail, model));
    group.addEventListener('blur', () => this.hideTooltip());
    group.addEventListener('keydown', (event) => this.onKey(event, point.start, model));
    return group;
  }

  private barLabel(bar: ChartBar, detail: UsageDetail): string {
    const point = bar.point;
    if (bar.future) return `${whenLabel(point, detail)}: ${t('usage.chart.future')}`;
    return t('usage.bar.label', {
      when: whenLabel(point, detail),
      total: formatInteger(point.tokens),
      cost: formatCost(point.costUSD),
      input: formatInteger(point.input),
      output: formatInteger(point.output),
      cacheWrite: formatInteger(point.cacheWrite),
      cacheRead: formatInteger(point.cacheRead),
    });
  }

  private onKey(event: KeyboardEvent, start: number, model: ChartModel): void {
    const current = model.bars.findIndex((bar) => bar.point.start === start);
    const last = model.bars.length - 1;
    const next = event.key === 'ArrowRight' ? Math.min(last, current + 1) : event.key === 'ArrowLeft' ? Math.max(0, current - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : -1;
    if (next < 0) return;
    event.preventDefault();
    const nodes = Array.from(this.el.querySelectorAll<SVGGElement>('.ao-usage-bar'));
    for (const node of nodes) node.tabIndex = -1;
    const target = nodes[next];
    if (target === undefined) return;
    target.tabIndex = 0;
    target.focus();
  }

  private showTooltip(bar: ChartBar, detail: UsageDetail, model: ChartModel): void {
    const point = bar.point;
    const rows = [...model.kinds]
      .reverse()
      .map((kind) =>
        h('li', null, svg('svg', { class: 'ao-usage-swatch', width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': 'true' }, svg('rect', { width: 10, height: 10, rx: 2, class: `ao-usage-fill ao-usage-fill--${kind}` })), h('span', null, t(KIND_LABEL[kind])), h('strong', null, formatInteger(point[kind]))),
      );
    this.tooltip.replaceChildren(
      ...compact(
        h('div', { class: 'ao-usage-tooltip-head' }, whenLabel(point, detail)),
        bar.future ? h('p', null, t('usage.chart.future')) : h('div', { class: 'ao-usage-tooltip-total' }, h('strong', null, t('usage.tip.total', { n: formatInteger(point.tokens) })), h('span', null, t('usage.tip.cost', { cost: formatCost(point.costUSD) }))),
        bar.future ? null : h('ul', null, ...rows),
      ),
    );
    this.tooltip.hidden = false;
    // Beside the bar, never over it: to its right in the left half of the chart and to its left in the right half.
    const width = this.tooltip.offsetWidth;
    const onLeftHalf = bar.x + bar.width / 2 < this.el.clientWidth / 2;
    const left = onLeftHalf ? bar.x + bar.width + TOOLTIP_GAP : bar.x - width - TOOLTIP_GAP;
    this.tooltip.style.left = `${Math.min(Math.max(0, left), Math.max(0, this.el.clientWidth - width))}px`;
    this.tooltip.style.top = `${model.plot.top}px`;
  }

  private hideTooltip(): void {
    this.tooltip.hidden = true;
  }
}
