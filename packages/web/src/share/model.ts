// Builds what the card says from a day report: the title and date, the headline numbers (formatted for the language),
// the highlight and the caption. This is the privacy boundary of the card: it only reads totals and counts from the
// report, never the requests, task texts, commands, file paths or commit subjects, and project names only when the
// person turned them on.
import { type DayReport, reportTotals } from '@ai-office/shared';
import { t, type UiKey } from '../i18n';
import { formatCost, formatDateKeyLong, formatInteger, formatTokens, toDateKey } from '../ui/format';
import { formatWorkTime, projectLabel } from '../ui/model/report';
import { pickCaption, pickHighlight, type UiMsg } from './highlight';
import { selectStats, type StatSpec } from './stats';
import { REPO_URL, type CardModel, type CardStat, type ShareOptions, type StatId } from './types';

export interface CardInput {
  report: DayReport;
  options: Pick<ShareOptions, 'showProjectNames' | 'showUsage'>;
  /** Epoch ms of now: tells whether the report is today's. */
  now: number;
}

const BRAND = 'AI Office';

const LABELS: Readonly<Record<StatId, UiKey>> = {
  agents: 'share.stat.agents',
  time: 'share.stat.time',
  tasks: 'share.stat.tasks',
  commits: 'share.stat.commits',
  tests: 'share.stat.tests',
  files: 'share.stat.files',
  tokens: 'share.stat.tokens',
  cost: 'share.stat.cost',
};

function formatStat(spec: StatSpec): string {
  switch (spec.id) {
    case 'time':
      return formatWorkTime(spec.value);
    case 'tokens':
      return formatTokens(spec.value);
    case 'cost':
      return formatCost(spec.value);
    default:
      return formatInteger(spec.value);
  }
}

function render(message: UiMsg): string {
  return t(message.key, message.params);
}

function isToday(input: CardInput): boolean {
  return input.report.date === toDateKey(input.now);
}

export function buildCardStats(input: CardInput): CardStat[] {
  return selectStats(reportTotals(input.report), { showUsage: input.options.showUsage }).map((spec) => ({
    id: spec.id,
    value: formatStat(spec),
    label: t(LABELS[spec.id]),
    tone: spec.tone,
  }));
}

export function buildCardModel(input: CardInput): CardModel {
  const date = formatDateKeyLong(input.report.date);
  return {
    title: isToday(input) ? t('share.card.title.today') : t('share.card.title.day', { date }),
    date,
    brand: BRAND,
    stats: buildCardStats(input),
    highlight: render(
      pickHighlight(input.report, {
        showProjectNames: input.options.showProjectNames,
        unknownProject: projectLabel({ name: '' }),
      }),
    ),
    url: REPO_URL,
    tag: t('share.card.tag'),
  };
}

/** The text to paste next to the picture (it names the date when the report is not today's). */
export function buildCaption(input: CardInput): string {
  const totals = reportTotals(input.report);
  return render(
    pickCaption(input.report, {
      when: isToday(input) ? 'today' : 'day',
      date: formatDateKeyLong(input.report.date),
      url: REPO_URL,
      time: formatWorkTime(totals.activeMs),
    }),
  );
}
