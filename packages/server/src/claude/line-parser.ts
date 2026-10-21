// Robust parser: one JSONL line in, a typed ParsedLine (or null) out. Never throws.
import { asArray, asNumber, asRecord, asString } from '../util/fs-safe';
import type { AssistantBlock, LineMeta, ParsedLine, StructuredResult, ToolResultInfo, UsageInfo } from './types';

const INTERRUPT_PREFIX = '[Request interrupted by user';
const IGNORED_USER_PREFIXES = [
  '<system-reminder>',
  '<local-command-',
  '<bash-input>',
  '<bash-stdout>',
  '<bash-stderr>',
  'Caveat:',
];

function readMeta(line: Record<string, unknown>): LineMeta | undefined {
  const timestamp = asString(line.timestamp);
  const at = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
  if (!Number.isFinite(at)) return undefined;
  const meta: LineMeta = { at };
  const cwd = asString(line.cwd);
  if (cwd !== undefined) meta.cwd = cwd;
  const gitBranch = asString(line.gitBranch);
  if (gitBranch !== undefined && gitBranch !== 'HEAD') meta.gitBranch = gitBranch;
  const agentId = asString(line.agentId);
  if (agentId !== undefined) meta.agentId = agentId;
  const permissionMode = asString(line.permissionMode);
  if (permissionMode !== undefined) meta.permissionMode = permissionMode;
  return meta;
}

function number(value: unknown): number {
  return asNumber(value) ?? 0;
}

export function parseUsage(value: unknown): UsageInfo | undefined {
  const usage = asRecord(value);
  if (Object.keys(usage).length === 0) return undefined;
  const creation = asRecord(usage.cache_creation);
  const write5m = asNumber(creation.ephemeral_5m_input_tokens);
  const write1h = asNumber(creation.ephemeral_1h_input_tokens);
  const writeTotal = number(usage.cache_creation_input_tokens);
  const split = write5m !== undefined || write1h !== undefined;
  return {
    input: number(usage.input_tokens),
    output: number(usage.output_tokens),
    cacheWrite5m: split ? (write5m ?? 0) : writeTotal,
    cacheWrite1h: split ? (write1h ?? 0) : 0,
    cacheRead: number(usage.cache_read_input_tokens),
  };
}

/** Flattens a tool_result content (string or blocks) to text. */
export function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of asArray(content)) {
    const record = asRecord(block);
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text);
    else if (record.type === 'image') parts.push('[imagem]');
  }
  return parts.join('\n');
}

function countPatchLines(patch: unknown): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of asArray(patch)) {
    for (const row of asArray(asRecord(hunk).lines)) {
      if (typeof row !== 'string') continue;
      if (row.startsWith('+')) added++;
      else if (row.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

function parseStructured(value: unknown): StructuredResult | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) return undefined;
  let { added, removed } = countPatchLines(record.structuredPatch);
  if (record.type === 'create' && typeof record.content === 'string' && added === 0) {
    added = record.content.length === 0 ? 0 : record.content.split('\n').length;
    removed = 0;
  }
  const result: StructuredResult = {
    linesAdded: added,
    linesRemoved: removed,
    asyncAgent: record.isAsync === true || record.status === 'async_launched',
  };
  const backgroundTaskId = asString(record.backgroundTaskId);
  if (backgroundTaskId !== undefined) result.backgroundTaskId = backgroundTaskId;
  const agentId = asString(record.agentId);
  if (agentId !== undefined) result.agentId = agentId;
  const task = asRecord(record.task);
  const createdTaskId = asString(task.id) ?? (typeof task.id === 'number' ? String(task.id) : undefined);
  if (createdTaskId !== undefined) result.createdTaskId = createdTaskId;
  return result;
}

function tag(text: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text);
  const value = match?.[1]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

/** Parses the `<task-notification>` block Claude Code injects when a background task ends. */
export function parseNotificationText(text: string, meta: LineMeta): ParsedLine | undefined {
  if (!text.includes('<task-notification>')) return undefined;
  const status = tag(text, 'status');
  if (status === undefined) return undefined;
  const line: ParsedLine = { kind: 'notification', status, ...meta };
  const toolUseId = tag(text, 'tool-use-id');
  const taskId = tag(text, 'task-id');
  const summary = tag(text, 'summary');
  if (toolUseId !== undefined) line.toolUseId = toolUseId;
  if (taskId !== undefined) line.taskId = taskId;
  if (summary !== undefined) line.summary = summary;
  return line;
}

function promptFromText(text: string, meta: LineMeta): ParsedLine | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith(INTERRUPT_PREFIX)) return { kind: 'interrupt', ...meta };
  const notification = parseNotificationText(trimmed, meta);
  if (notification !== undefined) return notification;
  const commandName = tag(trimmed, 'command-name');
  if (commandName !== undefined) {
    const args = tag(trimmed, 'command-args');
    return { kind: 'prompt', text: args === undefined ? commandName : `${commandName} ${args}`, ...meta };
  }
  if (IGNORED_USER_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return undefined;
  return { kind: 'prompt', text: trimmed, ...meta };
}

function parseUser(line: Record<string, unknown>, meta: LineMeta): ParsedLine | undefined {
  if (line.isMeta === true) return undefined;
  const message = asRecord(line.message);
  const content = message.content;
  if (typeof content === 'string') return promptFromText(content, meta);
  const results: ToolResultInfo[] = [];
  const texts: string[] = [];
  for (const raw of asArray(content)) {
    const block = asRecord(raw);
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      results.push({
        toolUseId: block.tool_use_id,
        text: flattenContent(block.content),
        isError: block.is_error === true,
      });
    } else if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    }
  }
  if (results.length > 0) {
    const structured = parseStructured(line.toolUseResult);
    return { kind: 'tool-results', results, ...(structured !== undefined ? { structured } : {}), ...meta };
  }
  return promptFromText(texts.join('\n'), meta);
}

function parseBlocks(content: unknown): AssistantBlock[] {
  const blocks: AssistantBlock[] = [];
  if (typeof content === 'string') return content.length > 0 ? [{ type: 'text', text: content }] : blocks;
  for (const raw of asArray(content)) {
    const block = asRecord(raw);
    if (block.type === 'text' && typeof block.text === 'string') {
      blocks.push({ type: 'text', text: block.text });
    } else if (block.type === 'thinking') {
      blocks.push({ type: 'thinking', text: asString(block.thinking) ?? '' });
    } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: asRecord(block.input) });
    }
  }
  return blocks;
}

function parseAssistant(line: Record<string, unknown>, meta: LineMeta): ParsedLine {
  const message = asRecord(line.message);
  const model = asString(message.model);
  const synthetic = model === undefined || model.startsWith('<');
  const usage = synthetic ? undefined : parseUsage(message.usage);
  const result: ParsedLine = {
    kind: 'assistant',
    blocks: parseBlocks(message.content),
    apiError: line.isApiErrorMessage === true,
    ...meta,
  };
  const messageId = asString(message.id);
  if (messageId !== undefined) result.messageId = messageId;
  if (!synthetic && model !== undefined) result.model = model;
  const stopReason = asString(message.stop_reason);
  if (stopReason !== undefined) result.stopReason = stopReason;
  if (usage !== undefined) result.usage = usage;
  return result;
}

function parseAttachment(line: Record<string, unknown>, meta: LineMeta): ParsedLine | undefined {
  const attachment = asRecord(line.attachment);
  if (attachment.type !== 'queued_command') return undefined;
  const prompt = asString(attachment.prompt);
  return prompt === undefined ? undefined : parseNotificationText(prompt, meta);
}

/** Parses one raw JSONL line. Returns undefined for lines that are not relevant or not valid JSON. */
export function parseLine(raw: string): ParsedLine | undefined {
  const text = raw.trim();
  if (text.length === 0 || text[0] !== '{') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const line = asRecord(value);
  switch (line.type) {
    case 'custom-title': {
      const title = asString(line.customTitle)?.trim();
      return title === undefined || title.length === 0 ? undefined : { kind: 'title', title };
    }
    case 'last-prompt': {
      const lastPrompt = asString(line.lastPrompt)?.trim();
      return lastPrompt === undefined || lastPrompt.length === 0
        ? undefined
        : { kind: 'last-prompt', text: lastPrompt };
    }
    case 'mode': {
      const mode = asString(line.mode);
      return mode === undefined ? undefined : { kind: 'mode', mode };
    }
    case 'cost-state': {
      const costUSD = asNumber(line.totalCostUSD);
      if (costUSD === undefined) return undefined;
      return {
        kind: 'cost-state',
        costUSD,
        linesAdded: number(line.totalLinesAdded),
        linesRemoved: number(line.totalLinesRemoved),
      };
    }
    case 'queue-operation': {
      const content = asString(line.content);
      const at = Date.parse(asString(line.timestamp) ?? '');
      if (line.operation !== 'enqueue' || content === undefined || !Number.isFinite(at)) return undefined;
      return parseNotificationText(content, { at });
    }
    case 'user':
    case 'assistant':
    case 'system':
    case 'attachment': {
      const meta = readMeta(line);
      if (meta === undefined) return undefined;
      if (line.type === 'user') return parseUser(line, meta);
      if (line.type === 'assistant') return parseAssistant(line, meta);
      if (line.type === 'attachment') return parseAttachment(line, meta);
      const subtype = asString(line.subtype);
      if (subtype === undefined) return undefined;
      const content = asString(line.content);
      return { kind: 'system', subtype, ...(content !== undefined ? { text: content } : {}), ...meta };
    }
    default:
      return undefined;
  }
}
