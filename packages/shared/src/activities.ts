// Maps Claude Code tool calls and session events to the activity texts shown in the office.
// Every draft carries a localizable `msg` (shared catalog key + params) and the pt-BR rendering in `text`.
// Used by the server (real transcripts) and by the demo simulator, so both speak the same language.
import type { Activity, ActivityKind } from './model';
import { basename, oneLine, truncate } from './format';
import { type Msg, msg, sourceText } from './i18n';

export const ACTIVITY_TEXT_MAX = 60;
export const ACTIVITY_DETAIL_MAX = 400;
/** Longest value carried as a message parameter (the pt-BR `text` is cut to ACTIVITY_TEXT_MAX anyway). */
const PARAM_MAX = 200;
const PROMPT_PARAM_MAX = 40;
const MESSAGE_PARAM_MAX = 45;

/**
 * An activity before it gets an id and a timestamp. `text` is always `truncate(sourceText(msg), ACTIVITY_TEXT_MAX)`;
 * `detailMsg` is only present when the detail is generated prose (file names, commands and queries are data).
 */
export interface ActivityDraft {
  kind: ActivityKind;
  icon: string;
  text: string;
  msg: Msg;
  detail?: string;
  detailMsg?: Msg;
  error?: boolean;
  durationMs?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Bounded copy of a data value (file name, command, query...) to carry as a message parameter. */
function param(value: string): string {
  return truncate(value, PARAM_MAX);
}

function draft(kind: ActivityKind, icon: string, message: Msg, detail?: string, detailMsg?: Msg): ActivityDraft {
  const result: ActivityDraft = { kind, icon, text: truncate(sourceText(message), ACTIVITY_TEXT_MAX), msg: message };
  if (detail !== undefined && detail.length > 0) result.detail = truncate(detail, ACTIVITY_DETAIL_MAX);
  if (detailMsg !== undefined) result.detailMsg = detailMsg;
  return result;
}

/** Replaces the message of a draft (and the pt-BR text that goes with it): used for generated demo content. */
export function localizeDraft(source: ActivityDraft, message: Msg, detailMsg?: Msg): ActivityDraft {
  const result: ActivityDraft = { ...source, text: truncate(sourceText(message), ACTIVITY_TEXT_MAX), msg: message };
  if (detailMsg !== undefined) {
    result.detailMsg = detailMsg;
    result.detail = truncate(sourceText(detailMsg), ACTIVITY_DETAIL_MAX);
  }
  return result;
}

/**
 * Duration as a message ("42 s", "3 min 05 s", "1 h 20 min"): `duration.seconds|minutes|hours` with the numeric
 * parts `h`, `m` and `s` (the zero-padded ones are strings, so no digit grouping applies). Sentences take it as a
 * nested message parameter, e.g. `activity.done` = `{ duration: durationMsg(ms) }`.
 */
export function durationMsg(ms: number): Msg {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (totalSeconds < 60) return msg('duration.seconds', { s: totalSeconds });
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return msg('duration.minutes', { m: minutes, s: pad(totalSeconds % 60) });
  return msg('duration.hours', { h: Math.floor(minutes / 60), m: pad(minutes % 60) });
}

function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?([^/?#:]+)/i.exec(url);
  return match?.[1] !== undefined ? match[1].replace(/^www\./i, '') : truncate(url, 30);
}

/** "mcp__server__tool" -> { server, tool }. Server names lose the "claude_ai_" style prefixes. */
export function parseMcpName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined;
  const rest = name.slice(5);
  const split = rest.indexOf('__');
  if (split < 0) return { server: rest, tool: rest };
  return { server: rest.slice(0, split), tool: rest.slice(split + 2) };
}

function fileLabel(input: Record<string, unknown>): { label: string | Msg; path?: string } {
  const path = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path);
  return path === undefined ? { label: msg('activity.file.generic') } : { label: param(basename(path)), path };
}

/** Activity for a tool_use block: `name` is the tool name, `input` its (untrusted) input object. */
export function describeToolUse(name: string, input: unknown): ActivityDraft {
  const args = asRecord(input);
  switch (name) {
    case 'Read': {
      const file = fileLabel(args);
      return draft('read', '📖', msg('activity.read', { file: file.label }), file.path);
    }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const file = fileLabel(args);
      return draft('edit', '✏️', msg('activity.edit', { file: file.label }), file.path);
    }
    case 'Write': {
      const file = fileLabel(args);
      return draft('write', '📝', msg('activity.write', { file: file.label }), file.path);
    }
    case 'Bash': {
      const command = str(args.command) ?? '';
      const description = str(args.description);
      const head = oneLine(command.split('\n')[0] ?? '');
      const shown = description ?? (head || undefined);
      return draft('bash', '💻', shown === undefined ? msg('activity.bash.generic') : msg('activity.bash.run', { text: param(shown) }), command);
    }
    case 'BashOutput':
    case 'TaskOutput':
      return draft('bash', '📤', msg('activity.bash.output'));
    case 'KillShell':
    case 'TaskStop':
      return draft('bash', '⏹️', msg('activity.bash.kill'));
    case 'Monitor': {
      const label = str(args.description) ?? str(args.command);
      return draft('bash', '👀', msg('activity.monitor', { label: label === undefined ? msg('activity.process.generic') : param(label) }), str(args.command));
    }
    case 'Grep':
    case 'Glob': {
      const pattern = str(args.pattern) ?? '';
      const path = str(args.path);
      const detailMsg = pattern.length > 0 && path !== undefined ? msg('activity.search.detail', { pattern: param(pattern), path: param(path) }) : undefined;
      return draft('search', '🔎', msg('activity.search', { pattern: param(pattern) }), [pattern, path].filter(Boolean).join(' em '), detailMsg);
    }
    case 'WebFetch': {
      const url = str(args.url) ?? '';
      return draft('web', '🌐', msg('activity.web.fetch', { host: hostOf(url) }), url);
    }
    case 'WebSearch': {
      const query = str(args.query) ?? '';
      return draft('web', '🌐', msg('activity.web.search', { query: param(query) }), query);
    }
    case 'Task':
    case 'Agent': {
      const description = str(args.description) ?? str(args.subagent_type);
      const shown = description === undefined ? msg('activity.task.generic') : param(description);
      return draft('subagent', '👥', msg('activity.subagent', { description: shown }), str(args.prompt));
    }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
    case 'TaskGet':
      return draft('task', '📋', msg('activity.todo'));
    case 'AskUserQuestion':
      return draft('question', '❓', msg('activity.question'));
    case 'ExitPlanMode':
      return draft('question', '🗺️', msg('activity.plan.present'), str(args.plan));
    case 'EnterPlanMode':
      return draft('other', '🗺️', msg('activity.plan.enter'));
    case 'Skill': {
      const skill = str(args.skill);
      return draft('other', '🧩', skill === undefined ? msg('activity.skill.generic') : msg('activity.skill', { skill: param(skill) }));
    }
    case 'ToolSearch':
      return draft('other', '🧰', msg('activity.tools.search'), str(args.query));
    default: {
      const mcp = parseMcpName(name);
      if (mcp !== undefined) return draft('mcp', '🔌', msg('activity.mcp', { server: param(mcp.server), tool: param(mcp.tool) }));
      return draft('other', '⚙️', msg('activity.other', { name: param(name) }));
    }
  }
}

export function thinkingDraft(): ActivityDraft {
  return draft('think', '💭', msg('activity.think'));
}

export function replyDraft(detail?: string): ActivityDraft {
  return draft('reply', '💬', msg('activity.reply'), detail);
}

/**
 * `prompt` is the user's text (data), or a generated prompt of the demo (pt-BR text plus its message): then the
 * message nests the prompt message, while `text` keeps the pt-BR prompt cut to 40 characters.
 */
export function promptDraft(prompt: string | { text: string; msg: Msg }): ActivityDraft {
  // Reserve room for the label and the quotes so the whole text stays within the limit.
  if (typeof prompt === 'string') return draft('prompt', '📨', msg('activity.prompt', { prompt: truncate(prompt, PROMPT_PARAM_MAX) }), prompt);
  const cut = draft('prompt', '📨', msg('activity.prompt', { prompt: truncate(prompt.text, PROMPT_PARAM_MAX) }), prompt.text, prompt.msg);
  return { ...cut, msg: msg('activity.prompt', { prompt: prompt.msg }) };
}

/** `detail` is the tool's error text (data) unless `detailMsg` says it is generated prose. */
export function errorDraft(toolName: string, detail?: string, detailMsg?: Msg): ActivityDraft {
  return { ...draft('error', '⚠️', msg('activity.error', { tool: param(toolName) }), detail, detailMsg), error: true };
}

export function doneDraft(durationMs: number): ActivityDraft {
  return { ...draft('done', '✅', msg('activity.done', { duration: durationMsg(durationMs) })), durationMs };
}

export function messageDraft(text: string): ActivityDraft {
  return draft('message', '📨', msg('activity.message', { text: truncate(text, MESSAGE_PARAM_MAX) }), text);
}

/** `summary` is the text of the request; pass `summaryMsg` when it is generated prose ("Editar src/a.ts"). */
export function permissionDraft(summary: string, summaryMsg?: Msg): ActivityDraft {
  return draft('permission', '🔐', msg('activity.permission', { summary: summaryMsg ?? param(summary) }), summary, summaryMsg);
}

/** An approval rule answered a request ("Regra aprovou: npm test"); `summary` is the request, as in permissionDraft. */
export function ruleDraft(effect: 'allow' | 'deny', summary: string, summaryMsg?: Msg): ActivityDraft {
  const key = effect === 'allow' ? 'activity.rule.allow' : 'activity.rule.deny';
  return draft('permission', effect === 'allow' ? '✅' : '🚫', msg(key, { summary: summaryMsg ?? param(summary) }), summary, summaryMsg);
}

/** Gives a draft its id and timestamp. */
export function toActivity(draftValue: ActivityDraft, id: string, at: number): Activity {
  return { id, at, ...draftValue };
}
