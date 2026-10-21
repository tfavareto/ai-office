// The body of the day report: one section per project (or per agent), a card per agent with its numbers and, on
// demand, the lists behind them (files, commits, tests, tasks, commands, requests).
import { type DayReport, type ReportAgent, reportTotals } from '@ai-office/shared';
import { t } from '../../i18n';
import { h } from '../dom';
import { formatClock, formatCost, formatTokens } from '../format';
import {
  type ReportEntry,
  type ReportGroupBy,
  type ReportSection,
  formatWorkTime,
  reportSections,
  sumActivity,
  testsByRunner,
  toolLabel,
  toolSummary,
} from '../model/report';
import { activityStrip, tileElement, tilesOf } from './report-parts';

const MAX_FILES = 10;
const MAX_ITEMS = 10;

function chip(text: string, tone?: 'good' | 'bad'): HTMLElement {
  return h('span', { class: `ao-report-chip${tone !== undefined ? ` is-${tone}` : ''}` }, text);
}

function list(title: string, items: readonly (Node | string)[], total: number): HTMLElement {
  const rows = items.map((item) => h('li', null, item));
  if (total > items.length)
    rows.push(h('li', { class: 'ao-report-more' }, t('report.more', { n: total - items.length })));
  return h('section', { class: 'ao-report-list' }, h('h5', null, title), h('ul', null, ...rows));
}

function code(text: string): HTMLElement {
  return h('code', null, text);
}

function details(agent: ReportAgent, report: DayReport): HTMLElement[] {
  const blocks: HTMLElement[] = [];
  if (agent.files.length > 0) {
    blocks.push(
      list(
        t('report.section.files', { n: agent.files.length }),
        agent.files
          .slice(0, MAX_FILES)
          .map((file) => h('span', null, code(file.path), ` +${file.added} −${file.removed}`)),
        agent.files.length,
      ),
    );
  }
  if (agent.commits.length > 0) {
    blocks.push(
      list(
        t('report.section.commits', { n: agent.commits.length }),
        agent.commits.slice(0, MAX_ITEMS).map((commit) => h('span', null, code(commit.hash), ` ${commit.subject}`)),
        agent.commits.length,
      ),
    );
  }
  if (agent.tests.length > 0) {
    blocks.push(
      list(
        t('report.section.tests'),
        testsByRunner(agent.tests).map((run) =>
          t('report.tests.runner', { runner: run.runner, passed: run.passed, failed: run.failed }),
        ),
        agent.tests.length,
      ),
    );
  }
  if (agent.tasks.length > 0)
    blocks.push(
      list(
        t('report.section.tasks', { n: agent.tasks.length }),
        agent.tasks.slice(0, MAX_ITEMS).map((task) => task.title),
        agent.tasks.length,
      ),
    );
  const tools = toolSummary(agent);
  if (tools.length > 0)
    blocks.push(
      list(t('report.section.tools'), [tools.map((tool) => `${toolLabel(tool.kind)} ${tool.count}`).join(' · ')], 1),
    );
  if (agent.commands.length > 0) {
    blocks.push(
      list(
        t('report.section.commands'),
        agent.commands
          .slice(0, MAX_ITEMS)
          .map((command) => h('span', null, code(command.command), command.runs > 1 ? ` ×${command.runs}` : '')),
        agent.commands.length,
      ),
    );
  }
  if (report.includeRequests && (agent.requests?.length ?? 0) > 0)
    blocks.push(
      list(t('report.section.requests'), (agent.requests ?? []).slice(0, MAX_ITEMS), agent.requests?.length ?? 0),
    );
  return blocks;
}

function agentCard(entry: ReportEntry, report: DayReport, dayStart: number, showHeader: boolean): HTMLElement {
  const { agent, totals } = entry;
  const chips = [
    chip(
      `${formatWorkTime(agent.activeMs)} · ${t('report.span', { from: formatClock(agent.firstAt), to: formatClock(agent.lastAt) })}`,
    ),
    totals.files > 0
      ? chip(`${t('report.stat.files')}: ${totals.files} (+${totals.linesAdded} −${totals.linesRemoved})`)
      : null,
    totals.commits > 0 ? chip(`${t('report.stat.commits')}: ${totals.commits}`) : null,
    totals.testsPassed + totals.testsFailed > 0
      ? chip(
          `${t('report.stat.tests')}: ${t('report.stat.testsValue', { passed: totals.testsPassed, failed: totals.testsFailed })}`,
          totals.testsFailed > 0 ? 'bad' : 'good',
        )
      : null,
    totals.tasks > 0 ? chip(`${t('report.stat.tasks')}: ${totals.tasks}`) : null,
    agent.usage.tokens > 0 ? chip(`${formatTokens(agent.usage.tokens)} · ${formatCost(agent.usage.costUSD)}`) : null,
  ];
  const more = details(agent, report);
  return h(
    'article',
    { class: 'ao-report-agent' },
    h(
      'header',
      null,
      showHeader ? h('strong', null, agent.name) : null,
      h('span', { class: 'ao-report-agent-prompts' }, t('report.line.prompts', { n: agent.prompts })),
    ),
    activityStrip(agent.activity, dayStart, { axis: false, label: `${agent.name}: ${t('report.timeline')}` }),
    h('div', { class: 'ao-report-chips' }, ...chips),
    more.length > 0
      ? h('details', { class: 'ao-report-details' }, h('summary', null, t('report.details')), ...more)
      : null,
  );
}

function sectionElement(
  section: ReportSection,
  report: DayReport,
  dayStart: number,
  groupBy: ReportGroupBy,
): HTMLElement {
  const totals = section.totals;
  const summary = [
    formatWorkTime(totals.activeMs),
    totals.files > 0 ? `${t('report.stat.files')} ${totals.files}` : null,
    totals.commits > 0 ? `${t('report.stat.commits')} ${totals.commits}` : null,
    totals.tasks > 0 ? `${t('report.stat.tasks')} ${totals.tasks}` : null,
    totals.costUSD > 0 ? formatCost(totals.costUSD) : null,
  ].filter((part): part is string => part !== null);
  return h(
    'section',
    { class: 'ao-report-section' },
    h(
      'header',
      { class: 'ao-report-section-head' },
      h('h4', null, section.title),
      section.subtitle !== undefined ? h('span', { class: 'ao-report-agent-project' }, section.subtitle) : null,
      h('span', { class: 'ao-report-section-sum' }, summary.join(' · ')),
    ),
    ...(groupBy === 'project'
      ? [activityStrip(section.activity, dayStart, { axis: false, label: `${section.title}: ${t('report.timeline')}` })]
      : []),
    h(
      'div',
      { class: 'ao-report-agents' },
      ...section.entries.map((entry) => agentCard(entry, report, dayStart, groupBy === 'project')),
    ),
  );
}

/** Headline tiles, the day's activity strip, the highlights and the sections. */
export function reportBody(
  report: DayReport,
  dayStart: number,
  groupBy: ReportGroupBy,
  highlights: readonly string[],
): HTMLElement[] {
  const nodes = [
    h('div', { class: 'ao-report-tiles' }, ...tilesOf(reportTotals(report)).map(tileElement)),
    activityStrip(sumActivity(report.projects.flatMap((project) => project.agents)), dayStart, {
      axis: true,
      label: t('report.timeline'),
    }),
    highlights.length > 0
      ? h('ul', { class: 'ao-report-highlights' }, ...highlights.map((text) => h('li', null, text)))
      : null,
    h(
      'div',
      { class: `ao-report-sections is-${groupBy === 'agent' ? 'agents' : 'projects'}` },
      ...reportSections(report, groupBy).map((section) => sectionElement(section, report, dayStart, groupBy)),
    ),
  ];
  return nodes.filter((node): node is HTMLElement => node !== null);
}
