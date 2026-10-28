// How a canvas terminal writes a conversation: the way the Claude Code CLI prints it. A user prompt is `> …`, the
// assistant's text follows a `⏺`, a tool call is `⏺ Bash(npm test)` with its result indented under `⎿`, thinking is a
// dim `✻ Thinking…`, errors are red. Pure: an entry becomes a few lines, the DOM renderer only draws them.
import type { TranscriptEntry } from '@ai-office/shared';
import { t } from '../../i18n';
import { localized, toolSummary } from '../../ui/display';
import type { DisplayStatus } from '../../ui/model/status';
import { splitFences } from '../../ui/model/terminal';

export type CliKind = 'prompt' | 'text' | 'code' | 'tool' | 'result' | 'more' | 'thinking' | 'system';
/** normal text · dim (secondary) · ok/error/pending (a tool's bullet) · warn (amber) · accent (the prompt). */
export type CliTone = 'normal' | 'dim' | 'ok' | 'error' | 'pending' | 'warn' | 'accent';

export interface CliLine {
  kind: CliKind;
  /** The glyph in the left column ('>', '⏺', '⎿', '✻'), or '' to align with the text above. */
  gutter: string;
  text: string;
  tone: CliTone;
}

export interface FormatOptions {
  /** Lines of a tool result shown before "… +N lines". */
  resultLines: number;
  /** The reader opened this entry (a long result or a thinking block). */
  expanded: boolean;
  /** The session's folder: paths inside it are written relative to it, as the CLI does. */
  cwd?: string;
}

/** Result lines a terminal of the canvas shows, and a maximized one. */
export const RESULT_LINES = 3;
export const RESULT_LINES_MAXIMIZED = 12;
/** The longest argument written between the parentheses of a tool call. */
export const MAX_ARGUMENT = 140;

type ToolEntry = Extract<TranscriptEntry, { kind: 'tool' }>;

/** `claude-opus-4-1-20250805` reads as `opus-4-1`; other model names stay as they are. */
export function shortModel(model: string): string {
  return model
    .trim()
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '');
}

/** One line, cut with an ellipsis. */
export function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** A path inside `cwd` is written relative to it. */
export function relativePath(path: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return path;
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return path.startsWith(base) && path.length > base.length ? path.slice(base.length) : path;
}

/** A long path keeps its end, where the file name is. */
export function shortPath(path: string, max = 64): string {
  if (path.length <= max) return path;
  const parts = path.split('/');
  let tail = parts.pop() ?? path;
  while (parts.length > 0 && tail.length + (parts[parts.length - 1]?.length ?? 0) + 2 < max)
    tail = `${parts.pop() as string}/${tail}`;
  return `…/${tail}`;
}

/** `mcp__github__list_issues` reads as `github:list_issues`; other tool names stay as they are. */
export function toolName(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return mcp === null ? name : `${mcp[1] as string}:${mcp[2] as string}`;
}

function field(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** What goes between the parentheses: the command, the file, the pattern… or the summary when nothing fits. */
export function toolArgument(
  entry: Pick<ToolEntry, 'input' | 'summary' | 'summaryMsg' | 'icon'>,
  cwd?: string,
): string {
  const input =
    typeof entry.input === 'object' && entry.input !== null && !Array.isArray(entry.input)
      ? (entry.input as Record<string, unknown>)
      : {};
  const command = field(input, 'command');
  if (command !== undefined) return clip(command.split('\n')[0] ?? command, MAX_ARGUMENT);
  const path = field(input, 'file_path') ?? field(input, 'notebook_path');
  if (path !== undefined) return shortPath(relativePath(path, cwd));
  const pattern = field(input, 'pattern');
  if (pattern !== undefined) {
    const where = field(input, 'path');
    const shown = where === undefined ? undefined : shortPath(relativePath(where, cwd), 40);
    return clip(shown === undefined ? `"${pattern}"` : `"${pattern}" in ${shown}`, MAX_ARGUMENT);
  }
  const plain =
    field(input, 'url') ??
    field(input, 'query') ??
    field(input, 'description') ??
    field(input, 'detail') ??
    field(input, 'path');
  if (plain !== undefined) return clip(plain.startsWith('/') ? relativePath(plain, cwd) : plain, MAX_ARGUMENT);
  // The summary starts with the activity's emoji, which a terminal would not print.
  const summary = toolSummary({ kind: 'tool', at: 0, id: '', name: '', ...entry });
  const text = entry.icon !== undefined && summary.startsWith(entry.icon) ? summary.slice(entry.icon.length) : summary;
  return clip(text, MAX_ARGUMENT);
}

export function toolCall(entry: ToolEntry, cwd?: string): string {
  return `${toolName(entry.name)}(${toolArgument(entry, cwd)})`;
}

function resultLines(entry: ToolEntry, options: FormatOptions): CliLine[] {
  const raw = entry.result;
  if (raw === undefined || raw === '') return [];
  const tone: CliTone = entry.error === true ? 'error' : 'dim';
  // Like the CLI, a file that was read is a count, not its content.
  if (entry.name === 'Read' && entry.error !== true)
    return [{ kind: 'result', gutter: '⎿', text: t('pro.term.read', { n: raw.split('\n').length }), tone }];
  if (raw.trim() === '') return [];
  const lines = raw.replace(/\s+$/, '').split('\n');
  const shown = options.expanded ? lines : lines.slice(0, Math.max(1, options.resultLines));
  const out: CliLine[] = [{ kind: 'result', gutter: '⎿', text: shown.join('\n'), tone }];
  const hidden = lines.length - shown.length;
  if (hidden > 0) out.push({ kind: 'more', gutter: '', text: t('pro.term.more', { n: hidden }), tone: 'dim' });
  return out;
}

function assistantLines(text: string): CliLine[] {
  const blocks = splitFences(text);
  return blocks.map((block, index) => ({
    kind: block.kind === 'code' ? 'code' : 'text',
    gutter: index === 0 && block.kind === 'text' ? '⏺' : '',
    text: block.text,
    tone: 'normal',
  }));
}

/** The lines of one entry. */
export function formatEntry(entry: TranscriptEntry, options: FormatOptions): CliLine[] {
  switch (entry.kind) {
    case 'user':
      return [{ kind: 'prompt', gutter: '>', text: entry.text.trim(), tone: 'accent' }];
    case 'assistant':
      return assistantLines(entry.text);
    case 'thinking': {
      const head: CliLine = { kind: 'thinking', gutter: '✻', text: t('pro.term.thinking'), tone: 'dim' };
      return options.expanded ? [head, { kind: 'result', gutter: '', text: entry.text, tone: 'dim' }] : [head];
    }
    case 'tool': {
      const tone: CliTone = entry.result === undefined ? 'pending' : entry.error === true ? 'error' : 'ok';
      return [{ kind: 'tool', gutter: '⏺', text: toolCall(entry, options.cwd), tone }, ...resultLines(entry, options)];
    }
    case 'system':
      return [{ kind: 'system', gutter: '⎿', text: localized(entry.msg, entry.text), tone: 'dim' }];
  }
}

/** Whether a click on the entry can open or close something (a long result, a thinking block). */
export function canExpand(entry: TranscriptEntry, resultLimit: number): boolean {
  if (entry.kind === 'thinking') return entry.text.trim() !== '';
  if (entry.kind !== 'tool' || entry.result === undefined || entry.name === 'Read') return false;
  return entry.result.replace(/\s+$/, '').split('\n').length > resultLimit;
}

export interface StatusLine {
  glyph: string;
  text: string;
  tone: CliTone;
  /** The elapsed time is worth showing (not for an ended session). */
  timed: boolean;
}

const STATUS_GLYPH: Record<DisplayStatus, string> = {
  working: '✻',
  waiting: '◆',
  shell: '◐',
  idle: '○',
  done: '✓',
  error: '✗',
  offline: '■',
};

const STATUS_TONE: Record<DisplayStatus, CliTone> = {
  working: 'ok',
  waiting: 'warn',
  shell: 'accent',
  idle: 'dim',
  done: 'dim',
  error: 'error',
  offline: 'dim',
};

/** The CLI-like status line at the bottom of a terminal: `✻ working · 3:12`, `◆ waiting for you`, `✓ done`. */
export function statusLine(status: DisplayStatus): StatusLine {
  return {
    glyph: STATUS_GLYPH[status],
    text: t(`pro.term.status.${status}`),
    tone: STATUS_TONE[status],
    timed: status !== 'offline' && status !== 'done',
  };
}
