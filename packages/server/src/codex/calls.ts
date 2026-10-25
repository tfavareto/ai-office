// Maps Codex tool calls onto the tool vocabulary of the office (Bash, Edit, Write, WebSearch, TodoWrite...), so the
// activity texts, the day report and the time-lapse treat both CLIs alike.
import { asArray, asNumber, asRecord, asString } from '../util/fs-safe';
import { commandText } from './command-text';
import { type PatchFile, parsePatch } from './patch';

/** One tool call in the office vocabulary. */
export interface ToolStart {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Lines the call added and removed (file edits), when the record says so. */
  lines?: { added: number; removed: number };
}

export interface ToolOutcome {
  text: string;
  isError: boolean;
}

export const MAX_OUTPUT_CHARS = 8192;
const SHELL_TOOLS: ReadonlySet<string> = new Set(['shell', 'container.exec', 'shell_command', 'local_shell', 'exec']);
const PLAN_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed']);

function absolute(path: string, cwd: string | undefined): string {
  if (path.startsWith('/') || cwd === undefined || cwd.length === 0) return path;
  return `${cwd.replace(/\/+$/, '')}/${path.replace(/^\.\//, '')}`;
}

export function bash(id: string, command: string | undefined): ToolStart | undefined {
  return command === undefined || command.trim().length === 0 ? undefined : { id, name: 'Bash', input: { command } };
}

/** Edit/Write tool calls for the files of a patch; the first keeps `id`, the others get a numbered suffix. */
export function fileStarts(id: string, files: readonly PatchFile[], cwd: string | undefined): ToolStart[] {
  return files.map((file, index) => ({
    id: index === 0 ? id : `${id}#${index}`,
    name: file.op === 'add' ? 'Write' : 'Edit',
    input: { file_path: absolute(file.path, cwd) },
    lines: { added: file.added, removed: file.removed },
  }));
}

export function webSearch(id: string, query: string | undefined): ToolStart {
  return { id, name: 'WebSearch', input: { query: query ?? '' } };
}

export function webOpen(id: string, url: string | undefined): ToolStart {
  return { id, name: 'WebFetch', input: { url: url ?? '' } };
}

export function mcpName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

function planStart(id: string, args: Record<string, unknown>): ToolStart {
  const todos = asArray(args.plan).flatMap((raw) => {
    const item = asRecord(raw);
    const step = asString(item.step);
    if (step === undefined || step.trim().length === 0) return [];
    const status = asString(item.status);
    return [{ content: step, status: status !== undefined && PLAN_STATUSES.has(status) ? status : 'pending' }];
  });
  return { id, name: 'TodoWrite', input: { todos } };
}

/** The arguments of a function call: a JSON string in rollouts, sometimes already an object. */
export function parseArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return asRecord(value);
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

export interface CallInfo {
  id: string;
  name: string;
  namespace?: string | undefined;
  args: Record<string, unknown>;
  cwd: string | undefined;
}

/**
 * The tool calls a `function_call` stands for. An empty list means the call is bookkeeping with nothing to show (for
 * instance writing to a running process's stdin).
 */
export function fromFunctionCall(call: CallInfo): ToolStart[] {
  const { id, name, args } = call;
  if (SHELL_TOOLS.has(name)) return list(bash(id, commandText(args.command)));
  if (name === 'exec_command') return list(bash(id, commandText(args.cmd)));
  if (name === 'write_stdin' || name === 'exec') return [];
  if (name === 'update_plan') return [planStart(id, args)];
  if (name === 'apply_patch') return fromPatch(id, asString(args.input) ?? asString(args.patch), call.cwd);
  if (name === 'view_image') return [{ id, name: 'Read', input: { file_path: asString(args.path) ?? '' } }];
  if (name.startsWith('request_user_input')) return [{ id, name: 'AskUserQuestion', input: {} }];
  if (name === 'spawn_agent') {
    const description = asString(args.agent_type) ?? asString(args.name);
    return [{ id, name: 'Agent', input: description === undefined ? {} : { description } }];
  }
  if (call.namespace !== undefined && call.namespace.length > 0) {
    const server = call.namespace.replace(/^mcp__/, '');
    return [{ id, name: mcpName(server, name), input: {} }];
  }
  return [{ id, name, input: {} }];
}

/** A `custom_tool_call`: Codex sends `apply_patch` this way; its `exec` wrapper is described by the item events. */
export function fromCustomCall(id: string, name: string, input: unknown, cwd: string | undefined): ToolStart[] {
  if (name === 'apply_patch') return fromPatch(id, asString(input), cwd);
  return [];
}

/** A `local_shell_call` (the shell Codex runs for models that have it built in). */
export function fromLocalShell(id: string, action: Record<string, unknown>): ToolStart[] {
  return list(bash(id, commandText(action.command)));
}

export function fromPatch(id: string, patch: string | undefined, cwd: string | undefined): ToolStart[] {
  if (patch === undefined) return [];
  const files = parsePatch(patch);
  return files.length === 0 ? [] : fileStarts(id, files, cwd);
}

function list(start: ToolStart | undefined): ToolStart[] {
  return start === undefined ? [] : [start];
}

/**
 * The outcome of a tool output. Rollouts store it as text, as a list of `{ text }` parts, or as JSON of the form
 * `{ "output": ..., "metadata": { "exit_code": n } }`.
 */
export function readOutput(value: unknown): ToolOutcome {
  const text = typeof value === 'string' ? value : outputParts(value);
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = asRecord(JSON.parse(text));
      const inner = asString(parsed.output);
      if (inner !== undefined) {
        const exit = asNumber(asRecord(parsed.metadata).exit_code);
        return { text: inner.slice(0, MAX_OUTPUT_CHARS), isError: exit !== undefined && exit !== 0 };
      }
    } catch {
      // Plain text that merely starts with a brace.
    }
  }
  return { text: text.slice(0, MAX_OUTPUT_CHARS), isError: false };
}

function outputParts(value: unknown): string {
  return asArray(value)
    .map((part) => asString(asRecord(part).text) ?? '')
    .filter((part) => part.length > 0)
    .join('\n');
}
