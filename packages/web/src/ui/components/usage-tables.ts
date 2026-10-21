// Breakdown tables of the usage dialog: by model, by project and by session or agent. Sessions and projects the
// office knows are buttons that select the person or the room.
import {
  type UsageDetail,
  type UsageModelRow,
  type UsageProjectRow,
  type UsageSessionRow,
  type UsageTotals,
  modelLabel,
} from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext } from '../context';
import { agentRole, localizedOptional } from '../display';
import { type Child, h } from '../dom';
import { formatCost, formatMoment, formatShare, formatTokens } from '../format';
import { sessionLabel, shareOf } from '../model/usage-view';

type Align = 'start' | 'end';

function headCell(text: string, align: Align = 'end', className = ''): HTMLTableCellElement {
  return h('th', { scope: 'col', class: `ao-usage-th ao-usage-th--${align} ${className}`.trim() }, text);
}

function numberCells(row: UsageTotals, whole: UsageTotals): HTMLTableCellElement[] {
  const share = shareOf(row, whole);
  return [
    h('td', { class: 'ao-usage-num', title: String(Math.round(row.tokens)) }, formatTokens(row.tokens)),
    h('td', { class: 'ao-usage-num' }, formatCost(row.costUSD)),
    h(
      'td',
      { class: 'ao-usage-share' },
      h(
        'span',
        { class: 'ao-usage-share-bar', 'aria-hidden': 'true' },
        h('span', { style: `width:${Math.max(share > 0 ? 2 : 0, share * 100).toFixed(1)}%` }),
      ),
      h('span', { class: 'ao-usage-share-text' }, formatShare(share)),
    ),
  ];
}

function table(
  titleId: string,
  title: string,
  columns: readonly HTMLTableCellElement[],
  rows: readonly HTMLTableRowElement[],
  note?: string,
): HTMLElement {
  return h(
    'section',
    { class: 'ao-usage-card-block', 'aria-labelledby': titleId },
    h('h3', { id: titleId, class: 'ao-usage-h' }, title),
    h(
      'div',
      { class: 'ao-usage-tablewrap' },
      h('table', { class: 'ao-usage-table' }, h('thead', null, h('tr', null, ...columns)), h('tbody', null, ...rows)),
    ),
    note === undefined ? null : h('p', { class: 'ao-usage-rest' }, note),
  );
}

function link(label: string, title: string, onClick: () => void): HTMLButtonElement {
  return h('button', { type: 'button', class: 'ao-usage-link', title, onclick: onClick }, label);
}

function modelRow(row: UsageModelRow, whole: UsageTotals): HTMLTableRowElement {
  return h(
    'tr',
    null,
    h(
      'th',
      { scope: 'row', class: 'ao-usage-name' },
      h('span', { class: `ao-usage-family ao-usage-family--${row.family}`, 'aria-hidden': 'true' }),
      h('span', { title: row.model }, modelLabel(row.model)),
    ),
    ...numberCells(row, whole),
  );
}

export function modelsTable(detail: UsageDetail): HTMLElement {
  const columns = [
    headCell(t('usage.col.model'), 'start'),
    headCell(t('usage.col.tokens')),
    headCell(t('usage.col.cost')),
    headCell(t('usage.col.share'), 'start'),
  ];
  return table(
    'ao-usage-models-h',
    t('usage.models.title'),
    columns,
    detail.byModel.map((row) => modelRow(row, detail.totals)),
  );
}

function projectCell(ctx: AppContext, row: Pick<UsageProjectRow, 'project' | 'name'>): Child {
  const name = row.project === '' ? t('usage.unknownProject') : row.name;
  const room = row.project === '' ? undefined : ctx.project(row.project);
  if (room === undefined) return h('span', { title: row.project }, name);
  return link(name, t('usage.session.select', { name }), () => {
    ctx.closeDialog();
    ctx.selectRoom(room.id, { focus: true });
  });
}

export function projectsTable(ctx: AppContext, detail: UsageDetail): HTMLElement {
  const columns = [
    headCell(t('usage.col.project'), 'start'),
    headCell(t('usage.col.tokens')),
    headCell(t('usage.col.cost')),
    headCell(t('usage.col.share'), 'start'),
  ];
  const rows = detail.byProject.map((row: UsageProjectRow) =>
    h(
      'tr',
      null,
      h('th', { scope: 'row', class: 'ao-usage-name' }, projectCell(ctx, row)),
      ...numberCells(row, detail.totals),
    ),
  );
  return table('ao-usage-projects-h', t('usage.projects.title'), columns, rows);
}

function sessionCell(ctx: AppContext, row: UsageSessionRow): HTMLElement {
  const agent = row.officeId === undefined ? undefined : ctx.agent(row.officeId);
  const label = sessionLabel(row, localizedOptional(row.titleMsg, row.title));
  const title =
    label.title ?? t(label.isSub ? 'usage.session.fallbackSub' : 'usage.session.fallback', { id: label.shortId });
  const role =
    row.role === undefined && row.roleMsg === undefined
      ? undefined
      : agentRole({ role: row.role ?? '', roleMsg: row.roleMsg });
  const kind = label.isSub && role !== undefined && role !== '' ? t('usage.session.sub', { role }) : null;
  const heading =
    agent === undefined
      ? h('span', { class: 'ao-usage-session-title', title }, title)
      : link(title, t('usage.session.select', { name: agent.name }), () => {
          ctx.closeDialog();
          ctx.selectAgent(agent.id, { focus: true });
        });
  return h(
    'div',
    { class: 'ao-usage-session' },
    heading,
    h(
      'span',
      { class: 'ao-usage-session-meta' },
      agent === undefined ? null : h('span', { class: 'ao-usage-person' }, agent.name),
      kind === null ? null : h('span', null, kind),
      h(
        'span',
        { class: 'ao-usage-session-project' },
        projectCell(ctx, { project: row.project, name: row.projectName }),
      ),
    ),
  );
}

export function sessionsTable(ctx: AppContext, detail: UsageDetail): HTMLElement {
  const now = ctx.now();
  const columns = [
    headCell(t('usage.col.session'), 'start'),
    headCell(t('usage.col.tokens')),
    headCell(t('usage.col.cost')),
    headCell(t('usage.col.share'), 'start'),
    headCell(t('usage.col.last'), 'end', 'ao-usage-hide-narrow'),
  ];
  const rows = detail.bySession.map((row) =>
    h(
      'tr',
      null,
      h('th', { scope: 'row', class: 'ao-usage-name ao-usage-name--session' }, sessionCell(ctx, row)),
      ...numberCells(row, detail.totals),
      h('td', { class: 'ao-usage-num ao-usage-hide-narrow' }, formatMoment(row.lastAt, now)),
    ),
  );
  const left = detail.sessionCount - detail.bySession.length;
  return table(
    'ao-usage-sessions-h',
    t('usage.sessions.title'),
    columns,
    rows,
    left > 0 ? t('usage.sessions.more', { n: left }) : undefined,
  );
}
