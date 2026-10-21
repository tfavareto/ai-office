// Small pieces of the day report: the activity strip, the headline tiles and the day picker.
import { REPORT_BUCKETS, REPORT_BUCKET_MS, type ReportTotals } from '@ai-office/shared';
import { t } from '../../i18n';
import { h } from '../dom';
import { formatClock, formatCost, formatDayShort, formatDuration, formatHourLabel, formatTokens } from '../format';
import { formatWorkTime, intensity } from '../model/report';

const AXIS_HOURS = [0, 6, 12, 18, 24] as const;

/** One bar per half hour; the brighter, the busier. Decorative for assistive technology but summarized in its label. */
export function activityStrip(
  activity: readonly number[],
  dayStart: number,
  options: { axis: boolean; label: string },
): HTMLElement {
  const cells = Array.from({ length: REPORT_BUCKETS }, (_, i) => {
    const ms = activity[i] ?? 0;
    const from = dayStart + i * REPORT_BUCKET_MS;
    return h('span', {
      class: 'ao-report-cell',
      style: `--v:${intensity(ms).toFixed(2)}`,
      ...(ms > 0
        ? {
            title: t('report.timeline.cell', {
              from: formatClock(from),
              to: formatClock(from + REPORT_BUCKET_MS),
              time: formatDuration(ms),
            }),
          }
        : {}),
    });
  });
  const busy = activity.filter((ms) => ms > 0).length;
  const strip = h(
    'div',
    {
      class: 'ao-report-strip',
      role: 'img',
      'aria-label': `${options.label}: ${formatDuration(activity.reduce((sum, ms) => sum + ms, 0))}`,
      'data-busy': String(busy),
    },
    ...cells,
  );
  if (!options.axis) return strip;
  const axis = h(
    'div',
    { class: 'ao-report-axis', 'aria-hidden': 'true' },
    ...AXIS_HOURS.map((hour) =>
      h('span', { style: `left:${(hour / 24) * 100}%` }, formatHourLabel(dayStart + hour * 3_600_000)),
    ),
  );
  return h('div', { class: 'ao-report-timeline' }, strip, axis);
}

export interface Tile {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'bad';
}

export function tilesOf(totals: ReportTotals): Tile[] {
  const tests = totals.testsPassed + totals.testsFailed;
  return [
    { label: t('report.stat.agents'), value: String(totals.agents) },
    { label: t('report.stat.time'), value: formatWorkTime(totals.activeMs) },
    {
      label: t('report.stat.files'),
      value: String(totals.files),
      hint:
        totals.files > 0
          ? t('report.stat.lines', { added: totals.linesAdded, removed: totals.linesRemoved })
          : undefined,
    },
    { label: t('report.stat.commits'), value: String(totals.commits) },
    {
      label: t('report.stat.tests'),
      value: String(tests),
      ...(tests > 0
        ? {
            hint: t('report.stat.testsValue', { passed: totals.testsPassed, failed: totals.testsFailed }),
            tone: totals.testsFailed > 0 ? ('bad' as const) : ('good' as const),
          }
        : {}),
    },
    { label: t('report.stat.tasks'), value: String(totals.tasks) },
    {
      label: t('report.stat.cost'),
      value: totals.costUSD > 0 ? formatCost(totals.costUSD) : '—',
      hint: totals.tokens > 0 ? `${formatTokens(totals.tokens)} ${t('report.stat.tokens').toLowerCase()}` : undefined,
    },
  ];
}

export function tileElement(tile: Tile): HTMLElement {
  return h(
    'div',
    { class: `ao-report-tile${tile.tone !== undefined ? ` is-${tile.tone}` : ''}` },
    h('span', { class: 'ao-report-tile-label' }, tile.label),
    h('strong', { class: 'ao-report-tile-value' }, tile.value),
    tile.hint !== undefined ? h('span', { class: 'ao-report-tile-hint' }, tile.hint) : null,
  );
}

/** "Hoje", "Ontem", then short weekday and day. */
export function pickerLabel(date: string, index: number): string {
  if (index === 0) return t('time.today');
  if (index === 1) return t('time.yesterday');
  const [year, month, day] = date.split('-').map(Number);
  return formatDayShort(new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12).getTime());
}
