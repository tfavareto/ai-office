// Translates Codex rollout lines into the same ParsedLine events the Claude transcripts produce, so the office model,
// the terminal view, the day report and the time-lapse need no second code path. One translator per file: it keeps the
// few facts that span lines (model, folder, open tool calls, a pending approval).
//
// Which record feeds what (a rollout can carry the same thing twice, so each fact has exactly one source):
//   prompts         event_msg user_message (CLI) and item_completed UserMessage (app); response_item user messages are
//                   mostly injected context and are ignored
//   replies/think   response_item message (assistant) and reasoning
//   tool calls      response_item function_call / custom_tool_call / local_shell_call / web_search_call, the item_completed
//                   items of the app (CommandExecution, FileChange, McpToolCall, Extension, ImageView) and the begin/end
//                   events of the CLI; the same call_id is never counted twice
//   turns           event_msg task_started / task_complete / turn_aborted
//   approvals       exec_approval_request, apply_patch_approval_request, request_permissions, elicitation_request
//   usage           event_msg token_count (running totals of the session)
import type { AssistantBlock, LineMeta, ParsedLine, UsageInfo } from '../claude/types';
import { asArray, asNumber, asRecord, asString } from '../util/fs-safe';
import {
  type CallInfo,
  type ToolOutcome,
  type ToolStart,
  bash,
  fileStarts,
  fromCustomCall,
  fromFunctionCall,
  fromLocalShell,
  mcpName,
  parseArguments,
  readOutput,
  webOpen,
  webSearch,
} from './calls';
import { commandText } from './command-text';
import { countDiffLines, countLines, type PatchFile } from './patch';
import { type RolloutRecord, readRecord } from './record';

const MAX_TEXT_CHARS = 8192;
const SESSION_USAGE_ID = 'codex-session-total';
const OK: ToolOutcome = { text: '', isError: false };
const MAX_TRACKED_CALLS = 2000;
const PROMPT_DEDUPE_MS = 2000;
/** User messages that are context Codex injected, not something the person typed. */
const INJECTED_PREFIXES = [
  '<environment_context>',
  '<user_instructions>',
  '<turn_aborted>',
  '<subagent_notification>',
  '<permissions instructions>',
  '<collaboration_mode>',
  '# AGENTS.md instructions',
];
/** Records that show progress after an approval request: the request was answered. */
const PROGRESS_EVENTS: ReadonlySet<string> = new Set([
  'exec_command_begin',
  'exec_command_end',
  'patch_apply_begin',
  'patch_apply_end',
  'mcp_tool_call_begin',
  'mcp_tool_call_end',
  'web_search_end',
  'user_message',
  'item_completed',
  'task_complete',
  'turn_complete',
  'turn_aborted',
]);
const PROGRESS_ITEMS: ReadonlySet<string> = new Set([
  'function_call_output',
  'custom_tool_call_output',
  'message',
  'reasoning',
]);
const APPROVAL_EVENTS: Readonly<Record<string, string>> = {
  exec_approval_request: 'Bash',
  apply_patch_approval_request: 'Edit',
  request_permissions: 'Bash',
  elicitation_request: 'mcp',
};

/** Token counters of a session as the usage the office prices: cached input is a cache read, the rest is fresh. */
export function usageOf(totals: Record<string, unknown>): UsageInfo | undefined {
  const input = asNumber(totals.input_tokens);
  const output = asNumber(totals.output_tokens);
  if (input === undefined || output === undefined) return undefined;
  const cached = asNumber(totals.cached_input_tokens) ?? 0;
  const written = asNumber(totals.cache_write_input_tokens) ?? 0;
  return {
    input: Math.max(0, input - cached - written),
    output,
    cacheWrite5m: written,
    cacheWrite1h: 0,
    cacheRead: cached,
  };
}

function textOf(content: unknown): string {
  return asArray(content)
    .map((part) => asString(asRecord(part).text) ?? '')
    .filter((text) => text.length > 0)
    .join('\n');
}

export class RolloutTranslator {
  private model: string | undefined;
  private cwd: string | undefined;
  private branch: string | undefined;
  private permissionMode: string | undefined;
  private approvalOpen = false;
  private lastPrompt = { text: '', at: 0 };
  /** Calls waiting for their output, with the lines they changed (the output does not say). */
  private readonly open = new Map<string, ToolStart['lines']>();
  private readonly closed = new Map<string, true>();

  /** Lines for one raw rollout line. Unknown, malformed and oversized records yield none. */
  translate(raw: string): ParsedLine[] {
    const record = readRecord(raw);
    if (record === undefined) return [];
    const out: ParsedLine[] = [];
    this.dispatch(record, out);
    return out;
  }

  private meta(at: number): LineMeta {
    return {
      at,
      ...(this.cwd !== undefined ? { cwd: this.cwd } : {}),
      ...(this.branch !== undefined ? { gitBranch: this.branch } : {}),
      ...(this.permissionMode !== undefined ? { permissionMode: this.permissionMode } : {}),
    };
  }

  private dispatch(record: RolloutRecord, out: ParsedLine[]): void {
    const { type, payload } = record;
    const kind = asString(payload.type) ?? '';
    if (this.approvalOpen && answersApproval(type, kind)) this.resolveApproval(record.at, out);
    if (type === 'session_meta') this.onSessionMeta(record, out);
    else if (type === 'turn_context') this.onTurnContext(record, out);
    else if (type === 'event_msg') this.onEvent(kind, payload, record.at, out);
    else if (type === 'response_item') this.onResponseItem(kind, payload, record.at, out);
    else if (type === 'compacted') out.push({ kind: 'system', subtype: 'compact_boundary', ...this.meta(record.at) });
  }

  // ---- session facts ---------------------------------------------------------------------------------------

  private onSessionMeta(record: RolloutRecord, out: ParsedLine[]): void {
    this.cwd = asString(record.payload.cwd) ?? this.cwd;
    const branch = asString(asRecord(record.payload.git).branch);
    if (branch !== undefined && branch !== 'HEAD') this.branch = branch;
    out.push({ kind: 'system', subtype: 'session_meta', ...this.meta(record.at) });
  }

  private onTurnContext(record: RolloutRecord, out: ParsedLine[]): void {
    const { payload } = record;
    this.cwd = asString(payload.cwd) ?? this.cwd;
    this.model = asString(payload.model) ?? this.model;
    const policy = asString(payload.approval_policy);
    const sandbox = asString(asRecord(payload.sandbox_policy).type);
    if (policy !== undefined) this.permissionMode = sandbox === undefined ? policy : `${policy} · ${sandbox}`;
    out.push({
      kind: 'system',
      subtype: 'turn_context',
      ...(this.model !== undefined ? { model: this.model } : {}),
      ...this.meta(record.at),
    });
  }

  // ---- event_msg -------------------------------------------------------------------------------------------

  private onEvent(kind: string, payload: Record<string, unknown>, at: number, out: ParsedLine[]): void {
    switch (kind) {
      case 'task_started':
      case 'turn_started':
        out.push({ kind: 'turn-start', ...this.meta(at) });
        return;
      case 'task_complete':
      case 'turn_complete':
        out.push({ kind: 'turn-end', ...this.meta(at) });
        return;
      case 'turn_aborted':
        out.push({ kind: 'interrupt', ...this.meta(at) });
        return;
      case 'user_message':
        this.prompt(asString(payload.message), at, out);
        return;
      case 'token_count':
        this.onTokenCount(payload, at, out);
        return;
      case 'item_completed':
        this.onItem(asRecord(payload.item), at, out);
        return;
      case 'exec_command_begin':
        this.begin([bash(callIdOf(payload), commandText(payload.command))], at, out);
        return;
      case 'exec_command_end':
        this.onExecEnd(payload, at, out);
        return;
      case 'patch_apply_begin':
        this.begin(patchStarts(callIdOf(payload), payload.changes, this.cwd), at, out);
        return;
      case 'patch_apply_end': {
        const text = asString(payload.stdout) ?? asString(payload.stderr) ?? '';
        const outcome = { text: text.slice(0, MAX_TEXT_CHARS), isError: payload.success === false };
        this.instant(patchStarts(callIdOf(payload), payload.changes, this.cwd), outcome, at, out);
        return;
      }
      case 'web_search_end':
        this.instant([searchStart(callIdOf(payload), payload)], OK, at, out);
        return;
      case 'mcp_tool_call_begin':
        this.begin(mcpStarts(payload), at, out);
        return;
      case 'mcp_tool_call_end': {
        const result = asRecord(payload.result);
        this.instant(
          mcpStarts(payload),
          { text: '', isError: 'Err' in result || asRecord(result.Ok).isError === true },
          at,
          out,
        );
        return;
      }
      default:
        if (kind in APPROVAL_EVENTS) this.requestApproval(APPROVAL_EVENTS[kind] as string, at, out);
    }
  }

  private onTokenCount(payload: Record<string, unknown>, at: number, out: ParsedLine[]): void {
    const usage = usageOf(asRecord(asRecord(payload.info).total_token_usage));
    if (usage === undefined) return;
    const model = this.model === undefined ? {} : { model: this.model };
    out.push({ kind: 'usage', id: SESSION_USAGE_ID, ...model, usage, ...this.meta(at) });
  }

  private onExecEnd(payload: Record<string, unknown>, at: number, out: ParsedLine[]): void {
    const output = asString(payload.aggregated_output) ?? asString(payload.stdout) ?? '';
    const exit = asNumber(payload.exit_code);
    const outcome = { text: output.slice(0, MAX_TEXT_CHARS), isError: exit !== undefined && exit !== 0 };
    this.instant([bash(callIdOf(payload), commandText(payload.command))], outcome, at, out);
  }

  // ---- item_completed (the app) ----------------------------------------------------------------------------

  private onItem(item: Record<string, unknown>, at: number, out: ParsedLine[]): void {
    const id = asString(item.id) ?? '';
    switch (item.type) {
      case 'UserMessage':
        this.prompt(textOf(item.content), at, out);
        return;
      case 'CommandExecution': {
        const exit = asNumber(item.exit_code);
        const output =
          asString(item.aggregated_output) ?? asString(item.formatted_output) ?? asString(item.stdout) ?? '';
        const isError = asString(item.status) === 'failed' || (exit !== undefined && exit !== 0);
        this.instant(
          [bash(id, commandText(item.command))],
          { text: output.slice(0, MAX_TEXT_CHARS), isError },
          at,
          out,
        );
        return;
      }
      case 'FileChange': {
        const outcome = { text: asString(item.stdout) ?? '', isError: asString(item.status) === 'failed' };
        this.instant(fileChangeStarts(id, asRecord(item.changes), this.cwd), outcome, at, out);
        return;
      }
      case 'McpToolCall': {
        const isError = asString(item.status) === 'failed' || asRecord(item.result).isError === true;
        this.instant(mcpStarts(item), { text: '', isError }, at, out);
        return;
      }
      case 'Extension':
        this.instant(extensionStarts(id, item), OK, at, out);
        return;
      case 'ImageView':
        this.instant([{ id, name: 'Read', input: { file_path: asString(item.path) ?? '' } }], OK, at, out);
        return;
      default:
    }
  }

  // ---- response_item ---------------------------------------------------------------------------------------

  private onResponseItem(kind: string, payload: Record<string, unknown>, at: number, out: ParsedLine[]): void {
    switch (kind) {
      case 'message':
        if (payload.role === 'assistant')
          this.assistant([{ type: 'text', text: textOf(payload.content).slice(0, MAX_TEXT_CHARS) }], at, out);
        return;
      case 'reasoning':
        this.assistant([{ type: 'thinking', text: textOf(payload.summary).slice(0, MAX_TEXT_CHARS) }], at, out);
        return;
      case 'function_call': {
        const name = asString(payload.name) ?? '';
        const call: CallInfo = {
          id: asString(payload.call_id) ?? '',
          name,
          namespace: asString(payload.namespace),
          args: parseArguments(payload.arguments),
          cwd: this.cwd,
        };
        this.begin(name.length === 0 ? [] : fromFunctionCall(call), at, out);
        return;
      }
      case 'custom_tool_call':
        this.begin(fromCustomCall(callIdOf(payload), asString(payload.name) ?? '', payload.input, this.cwd), at, out);
        return;
      case 'local_shell_call':
        this.begin(
          fromLocalShell(callIdOf(payload) || (asString(payload.id) ?? ''), asRecord(payload.action)),
          at,
          out,
        );
        return;
      case 'web_search_call':
        this.instant([searchStart(asString(payload.id) ?? callIdOf(payload), payload)], OK, at, out);
        return;
      case 'function_call_output':
      case 'custom_tool_call_output':
        this.end(callIdOf(payload), readOutput(payload.output), at, out);
        return;
      default:
    }
  }

  // ---- building lines --------------------------------------------------------------------------------------

  private prompt(text: string | undefined, at: number, out: ParsedLine[]): void {
    const trimmed = text?.trim() ?? '';
    if (trimmed.length === 0 || INJECTED_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return;
    if (trimmed === this.lastPrompt.text && at - this.lastPrompt.at < PROMPT_DEDUPE_MS) return;
    this.lastPrompt = { text: trimmed, at };
    out.push({ kind: 'prompt', text: trimmed.slice(0, MAX_TEXT_CHARS), ...this.meta(at) });
  }

  private assistant(blocks: AssistantBlock[], at: number, out: ParsedLine[]): void {
    const useful = blocks.filter((block) => block.type !== 'text' || block.text.trim().length > 0);
    if (useful.length === 0) return;
    out.push(this.assistantLine(useful, at));
  }

  private assistantLine(blocks: AssistantBlock[], at: number): ParsedLine {
    return {
      kind: 'assistant',
      blocks,
      apiError: false,
      ...(this.model !== undefined ? { model: this.model } : {}),
      ...this.meta(at),
    };
  }

  /** Opens tool calls (one tool_use each). A call id seen before, open or closed, is not opened again. */
  private begin(starts: (ToolStart | undefined)[], at: number, out: ParsedLine[]): void {
    const fresh = starts.filter((start): start is ToolStart => start !== undefined && this.isNew(start.id));
    if (fresh.length === 0) return;
    for (const start of fresh) remember(this.open, start.id, start.lines);
    out.push(
      this.assistantLine(
        fresh.map((start) => ({ type: 'tool_use' as const, id: start.id, name: start.name, input: start.input })),
        at,
      ),
    );
  }

  /** Answers the open calls of a call id; a call that was never seen opening (read from the middle) is ignored. */
  private end(callId: string, outcome: ToolOutcome, at: number, out: ParsedLine[]): void {
    if (callId.length === 0) return;
    const ids = [...this.open.keys()].filter((id) => id === callId || id.startsWith(`${callId}#`));
    for (const id of ids) this.close(id, outcome, this.open.get(id), at, out);
  }

  private close(id: string, outcome: ToolOutcome, lines: ToolStart['lines'], at: number, out: ParsedLine[]): void {
    this.open.delete(id);
    remember(this.closed, id, true);
    const structured =
      lines === undefined
        ? {}
        : { structured: { linesAdded: lines.added, linesRemoved: lines.removed, asyncAgent: false } };
    out.push({
      kind: 'tool-results',
      results: [{ toolUseId: id, text: outcome.text, isError: outcome.isError }],
      ...structured,
      ...this.meta(at),
    });
  }

  /** A call whose begin and end arrive together, or whose begin was missed: open it if needed, then close it. */
  private instant(starts: (ToolStart | undefined)[], outcome: ToolOutcome, at: number, out: ParsedLine[]): void {
    const known = starts.filter((start): start is ToolStart => start !== undefined);
    this.begin(known, at, out);
    for (const start of known) if (this.open.has(start.id)) this.close(start.id, outcome, start.lines, at, out);
  }

  private isNew(id: string): boolean {
    return id.length > 0 && !this.open.has(id) && !this.closed.has(id);
  }

  private requestApproval(tool: string, at: number, out: ParsedLine[]): void {
    this.approvalOpen = true;
    out.push({ kind: 'approval', state: 'requested', tool, ...this.meta(at) });
  }

  private resolveApproval(at: number, out: ParsedLine[]): void {
    this.approvalOpen = false;
    out.push({ kind: 'approval', state: 'resolved', ...this.meta(at) });
  }
}

function remember<V>(map: Map<string, V>, id: string, value: V): void {
  map.set(id, value);
  if (map.size > MAX_TRACKED_CALLS) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function answersApproval(type: string, kind: string): boolean {
  if (type === 'event_msg') return PROGRESS_EVENTS.has(kind);
  return type === 'response_item' && PROGRESS_ITEMS.has(kind);
}

function callIdOf(payload: Record<string, unknown>): string {
  return asString(payload.call_id) ?? '';
}

// ---- helpers for the items ---------------------------------------------------------------------------------------

function patchStarts(id: string, changes: unknown, cwd: string | undefined): ToolStart[] {
  return fileChangeStarts(id, asRecord(changes), cwd);
}

/** `changes` maps a path to `{ type: add | update | delete, content | unified_diff }`. */
function fileChangeStarts(id: string, changes: Record<string, unknown>, cwd: string | undefined): ToolStart[] {
  const files: PatchFile[] = Object.entries(changes)
    .slice(0, 200)
    .map(([path, raw]) => {
      const change = asRecord(raw);
      const type = asString(change.type);
      const op = type === 'add' || type === 'delete' ? type : 'update';
      const content = asString(change.content);
      const diff = asString(change.unified_diff);
      const lines =
        diff !== undefined
          ? countDiffLines(diff)
          : {
              added: op === 'add' && content !== undefined ? countLines(content) : 0,
              removed: op === 'delete' && content !== undefined ? countLines(content) : 0,
            };
      return { op, path, added: lines.added, removed: lines.removed };
    });
  return fileStarts(id, files, cwd);
}

function mcpStarts(source: Record<string, unknown>): ToolStart[] {
  const invocation = asRecord(source.invocation);
  const server = asString(source.server) ?? asString(invocation.server);
  const tool = asString(source.tool) ?? asString(invocation.tool);
  const id = asString(source.call_id) ?? asString(source.id);
  if (server === undefined || tool === undefined || id === undefined) return [];
  return [{ id, name: mcpName(server, tool), input: {} }];
}

function searchStart(id: string, source: Record<string, unknown>): ToolStart {
  const action = asRecord(source.action);
  const url = asString(action.url);
  if (url !== undefined && action.type !== 'search') return webOpen(id, url);
  const queries = asArray(action.queries);
  return webSearch(id, asString(source.query) ?? asString(action.query) ?? asString(queries[0]));
}

function extensionStarts(id: string, item: Record<string, unknown>): ToolStart[] {
  const action = asRecord(item.action);
  if (asString(action.url) !== undefined || asString(action.query) !== undefined || asString(item.query) !== undefined)
    return [searchStart(id, item)];
  return [{ id, name: asString(item.kind) ?? 'Extension', input: {} }];
}
