// Summaries for permission requests and labels for Claude Code's "always allow" suggestions. Each comes as pt-BR text
// plus, when the text is generated (not a command or other data), its localizable message.
import { type Msg, basename, msg, parseMcpName, sourceText, truncate } from '@ai-office/shared';
import { asArray, asRecord, asString } from '../util/fs-safe';

const SUMMARY_MAX = 100;
const LABEL_MAX = 120;
const MAX_STRING = 2000;
const MAX_ITEMS = 50;
const MAX_DEPTH = 6;

export interface PermissionSummary {
  summary: string;
  /** Present when `summary` is generated prose ("Editar src/a.ts"); absent for commands and tool names. */
  summaryMsg?: Msg;
}

export interface SuggestionLabel {
  label: string;
  msg: Msg;
}

function generated(message: Msg): PermissionSummary {
  return { summary: sourceText(message), summaryMsg: message };
}

function fileSummary(key: 'perm.edit' | 'perm.write' | 'perm.read', file: string | undefined): PermissionSummary {
  return generated(msg(key, { file: file === undefined ? msg('perm.file.generic') : truncate(file, 80) }));
}

/** Short human summary of what the tool wants to do. */
export function describePermission(toolName: string, rawInput: unknown): PermissionSummary {
  const input = asRecord(rawInput);
  const file = asString(input.file_path) ?? asString(input.path) ?? asString(input.notebook_path);
  switch (toolName) {
    case 'Bash': {
      const command = asString(input.command);
      return command === undefined ? generated(msg('perm.bash.generic')) : { summary: truncate(command, SUMMARY_MAX) };
    }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return fileSummary('perm.edit', file);
    case 'Write':
      return fileSummary('perm.write', file);
    case 'Read':
      return fileSummary('perm.read', file);
    case 'WebFetch': {
      const url = asString(input.url) ?? '';
      const host = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url)?.[1];
      return generated(msg('perm.web.fetch', { host: host ?? truncate(url, 60) }));
    }
    case 'WebSearch':
      return generated(msg('perm.web.search', { query: truncate(asString(input.query) ?? '', 60) }));
    default: {
      const mcp = parseMcpName(toolName);
      if (mcp !== undefined) return { summary: `${mcp.server}: ${mcp.tool}` };
      return { summary: truncate(`${toolName}${file !== undefined ? ` ${basename(file)}` : ''}`, SUMMARY_MAX) };
    }
  }
}

/** pt-BR text of {@link describePermission}. */
export function summarizePermission(toolName: string, rawInput: unknown): string {
  return describePermission(toolName, rawInput).summary;
}

/** The `scope` select of the `perm.suggestion.*` messages. */
function scopeOf(destination: string | undefined): 'session' | 'project' | 'user' | 'none' {
  if (destination === 'session') return 'session';
  if (destination === 'localSettings' || destination === 'projectSettings') return 'project';
  if (destination === 'userSettings') return 'user';
  return 'none';
}

function ruleLabel(rule: unknown): string {
  const record = asRecord(rule);
  const tool = asString(record.toolName) ?? 'ferramenta';
  const content = asString(record.ruleContent);
  return content === undefined ? tool : `${tool}(${content})`;
}

/** Label for one `permission_suggestions` entry, e.g. "Sempre permitir Bash(npm test:*) neste projeto". */
export function describeSuggestion(raw: unknown): SuggestionLabel {
  const suggestion = asRecord(raw);
  const scope = scopeOf(asString(suggestion.destination));
  const labeled = (message: Msg, max?: number): SuggestionLabel => {
    const text = sourceText(message);
    return { label: max === undefined ? text : truncate(text, max), msg: message };
  };
  switch (suggestion.type) {
    case 'addRules': {
      const rules = truncate(asArray(suggestion.rules).map(ruleLabel).join(', '), LABEL_MAX);
      return labeled(
        msg(suggestion.behavior === 'deny' ? 'perm.suggestion.deny' : 'perm.suggestion.allow', { rules, scope }),
        LABEL_MAX,
      );
    }
    case 'setMode': {
      const mode = asString(suggestion.mode);
      return labeled(
        msg('perm.suggestion.mode', {
          mode: mode === undefined ? msg('perm.mode.new') : truncate(mode, LABEL_MAX),
          scope,
        }),
      );
    }
    case 'addDirectories': {
      const dirs = truncate(
        asArray(suggestion.directories)
          .filter((d) => typeof d === 'string')
          .join(', '),
        LABEL_MAX,
      );
      return labeled(msg('perm.suggestion.dirs', { dirs, scope }), LABEL_MAX);
    }
    default:
      return labeled(msg('perm.suggestion.remember', { scope }), LABEL_MAX);
  }
}

/** pt-BR text of {@link describeSuggestion}. */
export function suggestionLabel(raw: unknown): string {
  return describeSuggestion(raw).label;
}

/** Deep-trims untrusted tool input: long strings are cut, arrays and depth are capped. */
export function trimInput(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '…';
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => trimInput(item, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_ITEMS)) result[key] = trimInput(item, depth + 1);
  return result;
}
