// The day report as Markdown, in the language of the interface: a work diary or a status update to paste anywhere.
// Text that comes from the sessions (task titles, commit subjects, file names, commands, requests) is escaped so it can
// never turn into Markdown structure.
import { type DayReport, type ReportAgent, type ReportTotals, hasActivity, reportTotals } from '@ai-office/shared';
import { t } from '../../i18n';
import { formatClock, formatCost, formatDateKey, formatDuration, formatTokens } from '../format';
import { type ReportGroupBy, type ReportSection, formatWorkTime, reportHighlights, reportSections, testsByRunner, toolLabel, toolSummary } from './report';

const MAX_FILES = 12;
const MAX_COMMANDS = 8;
const MAX_ITEMS = 15;
const SEPARATOR = ' · ';

export interface MarkdownOptions {
  groupBy: ReportGroupBy;
  /** The label of the account the report covers; undefined means all accounts. */
  accountLabel?: string;
}

/** Escapes characters that would change the Markdown structure of a line of plain text. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\`*_[\]<>|])/g, '\\$1')
    .replace(/^([#>+-])/, '\\$1');
}

/** Text inside a code span: backticks cannot be escaped there, so they become apostrophes. */
function code(text: string): string {
  return `\`${text.replace(/\s+/g, ' ').replace(/`/g, "'")}\``;
}

const label = (key: Parameters<typeof t>[0], value: string): string => `**${t(key)}:** ${value}`;

function statParts(totals: ReportTotals): string[] {
  const parts: string[] = [];
  if (totals.activeMs > 0) parts.push(`${t('report.stat.time')}: ${formatWorkTime(totals.activeMs)}`);
  if (totals.files > 0) parts.push(`${t('report.stat.files')}: ${totals.files} (${t('report.stat.lines', { added: totals.linesAdded, removed: totals.linesRemoved })})`);
  if (totals.commits > 0) parts.push(`${t('report.stat.commits')}: ${totals.commits}`);
  if (totals.testsPassed + totals.testsFailed > 0) parts.push(`${t('report.stat.tests')}: ${t('report.stat.testsValue', { passed: totals.testsPassed, failed: totals.testsFailed })}`);
  if (totals.tasks > 0) parts.push(`${t('report.stat.tasks')}: ${totals.tasks}`);
  if (totals.tokens > 0) parts.push(`${t('report.stat.tokens')}: ${formatTokens(totals.tokens)}`);
  if (totals.costUSD > 0) parts.push(`${t('report.stat.cost')}: ${formatCost(totals.costUSD)}`);
  return parts;
}

function summaryLines(report: DayReport): string[] {
  const totals = reportTotals(report);
  return [`- ${t('report.stat.agents')}: ${totals.agents}`, ...statParts(totals).map((part) => `- ${part}`)];
}

function subagentText(agent: ReportAgent): string {
  const types = escapeMarkdown(agent.subagents.types.join(', '));
  return types.length > 0 ? `${agent.subagents.count} (${types})` : String(agent.subagents.count);
}

function more(total: number, shown: number): string[] {
  return total > shown ? [`  - ${t('report.more', { n: total - shown })}`] : [];
}

function agentLines(agent: ReportAgent, report: DayReport): string[] {
  const lines: string[] = [];
  const span = t('report.span', { from: formatClock(agent.firstAt), to: formatClock(agent.lastAt) });
  lines.push(`- ${label('report.stat.time', `${formatWorkTime(agent.activeMs)} (${span})`)}`);
  if (agent.statusMs !== undefined) {
    lines.push(`- ${t('report.line.status', { working: formatDuration(agent.statusMs.working), waiting: formatDuration(agent.statusMs.waiting), idle: formatDuration(agent.statusMs.idle) })}`);
  }
  if (agent.prompts > 0) lines.push(`- ${t('report.line.prompts', { n: agent.prompts })}`);
  if (agent.files.length > 0) {
    lines.push(`- **${t('report.section.files', { n: agent.files.length })}:**`);
    for (const file of agent.files.slice(0, MAX_FILES)) lines.push(`  - ${code(file.path)} (+${file.added} −${file.removed})`);
    lines.push(...more(agent.files.length, MAX_FILES));
  }
  if (agent.commits.length > 0) {
    lines.push(`- **${t('report.section.commits', { n: agent.commits.length })}:**`);
    for (const commit of agent.commits.slice(0, MAX_ITEMS)) lines.push(`  - ${code(commit.hash)} ${escapeMarkdown(commit.subject)}`);
    lines.push(...more(agent.commits.length, MAX_ITEMS));
  }
  if (agent.tests.length > 0) {
    lines.push(`- **${t('report.section.tests')}:**`);
    for (const run of testsByRunner(agent.tests)) lines.push(`  - ${t('report.tests.runner', { runner: escapeMarkdown(run.runner), passed: run.passed, failed: run.failed })}`);
  }
  if (agent.tasks.length > 0) {
    lines.push(`- **${t('report.section.tasks', { n: agent.tasks.length })}:**`);
    for (const task of agent.tasks.slice(0, MAX_ITEMS)) lines.push(`  - ${escapeMarkdown(task.title)}`);
    lines.push(...more(agent.tasks.length, MAX_ITEMS));
  }
  if (agent.subagents.count > 0) lines.push(`- ${label('report.section.subagents', subagentText(agent))}`);
  const tools = toolSummary(agent);
  if (tools.length > 0) lines.push(`- ${label('report.section.tools', tools.map((tool) => `${toolLabel(tool.kind)} ${tool.count}`).join(SEPARATOR))}`);
  if (agent.commands.length > 0) {
    lines.push(`- **${t('report.section.commands')}:**`);
    for (const command of agent.commands.slice(0, MAX_COMMANDS)) lines.push(`  - ${code(command.command)}${command.runs > 1 ? ` ×${command.runs}` : ''}`);
    lines.push(...more(agent.commands.length, MAX_COMMANDS));
  }
  if (agent.usage.tokens > 0 || agent.usage.costUSD > 0) lines.push(`- ${t('report.line.usage', { tokens: formatTokens(agent.usage.tokens), cost: formatCost(agent.usage.costUSD) })}`);
  if (report.includeRequests && (agent.requests?.length ?? 0) > 0) {
    lines.push(`- **${t('report.section.requests')}:**`);
    for (const request of (agent.requests ?? []).slice(0, MAX_ITEMS)) lines.push(`  - ${escapeMarkdown(request)}`);
  }
  return lines;
}

function sectionLines(section: ReportSection, report: DayReport, groupBy: ReportGroupBy): string[] {
  const heading = section.subtitle === undefined ? escapeMarkdown(section.title) : `${escapeMarkdown(section.title)} — ${escapeMarkdown(section.subtitle)}`;
  const lines = [`## ${heading}`, ''];
  if (groupBy === 'project') {
    const parts = statParts(section.totals);
    if (parts.length > 0) lines.push(parts.join(SEPARATOR), '');
    for (const entry of section.entries) lines.push(`### ${escapeMarkdown(entry.agent.name)}`, '', ...agentLines(entry.agent, report), '');
  } else {
    for (const entry of section.entries) lines.push(...agentLines(entry.agent, report), '');
  }
  return lines;
}

/** The whole report. An empty day still produces a valid document that says so. */
export function renderReportMarkdown(report: DayReport, options: MarkdownOptions): string {
  const scope = options.accountLabel === undefined ? t('report.md.scopeAll') : t('report.md.scopeAccount', { account: escapeMarkdown(options.accountLabel) });
  const lines = [`# ${t('report.md.title', { date: formatDateKey(report.date) })}`, '', t('report.md.meta', { scope, time: formatClock(report.generatedAt) }), ''];
  if (!hasActivity(report)) return [...lines, t('report.empty'), ''].join('\n');
  if (report.truncated === true) lines.push(`> ${t('report.notice.truncated')}`, '');
  lines.push(`## ${t('report.md.summary')}`, '', ...summaryLines(report), '');
  const highlights = reportHighlights(report);
  if (highlights.length > 0) lines.push(`## ${t('report.md.highlights')}`, '', ...highlights.map((text) => `- ${escapeMarkdown(text)}`), '');
  for (const section of reportSections(report, options.groupBy)) lines.push(...sectionLines(section, report, options.groupBy));
  lines.push('---', '', `_${t('report.md.footer')}_`, '');
  return lines.join('\n');
}
