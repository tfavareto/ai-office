// The request an approval rule judges, and what rules read from it (command, file, address).
import { commandOf, filePathOf } from '../permission-risk';
import type { PermissionRequest } from '../model';
import { foldCommand } from './command';
import { resolvePath } from './path';

/** A permission request plus where it comes from. */
export interface RuleRequest {
  toolName: string;
  input: unknown;
  summary: string;
  /** Absolute path of the project (room) of the agent that asks. */
  projectPath?: string;
  accountId?: string;
}

export const FILE_TOOLS: readonly string[] = ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
/** File tools that change files (the sensitive-file check applies to them). */
export const WRITE_TOOLS: readonly string[] = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

const SUBJECT_MAX = 200;

export function isFileTool(tool: string): boolean {
  return FILE_TOOLS.includes(tool);
}

function inputText(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** The raw shell command of a Bash request. */
export function commandOfRequest(request: Pick<RuleRequest, 'toolName' | 'input'>): string | undefined {
  const command = commandOf(request as Pick<PermissionRequest, 'toolName' | 'input'>);
  return command.length > 0 ? command : undefined;
}

/** Absolute path a file tool touches (a relative one is read from the project). */
export function pathOfRequest(request: RuleRequest): string | undefined {
  if (!isFileTool(request.toolName)) return undefined;
  const path = filePathOf(request as Pick<PermissionRequest, 'toolName' | 'input'>);
  return path === undefined || path.length === 0 ? undefined : resolvePath(path, request.projectPath);
}

export function urlOfRequest(request: Pick<RuleRequest, 'toolName' | 'input'>): string | undefined {
  return request.toolName === 'WebFetch' ? inputText(request.input, 'url') : undefined;
}

export function queryOfRequest(request: Pick<RuleRequest, 'toolName' | 'input'>): string | undefined {
  return request.toolName === 'WebSearch' ? inputText(request.input, 'query') : undefined;
}

/** `{ host, hostname }` of an http(s) address; undefined for anything else. */
export function hostOfUrl(url: string): { host: string; hostname: string } | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    return { host: parsed.host.toLowerCase(), hostname: parsed.hostname.toLowerCase() };
  } catch {
    return undefined;
  }
}

function cut(text: string): string {
  return text.length > SUBJECT_MAX ? `${text.slice(0, SUBJECT_MAX - 1)}…` : text;
}

/** An address without its query string, fragment and credentials (they can carry secrets). */
function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0] ?? '';
  }
}

/** What was asked, in one short line: the command, file, address or query (or the summary for other tools). */
export function subjectOf(request: RuleRequest): string {
  const command = commandOfRequest(request);
  if (command !== undefined) return cut(foldCommand(command));
  const path = pathOfRequest(request);
  if (path !== undefined) return cut(path);
  const url = urlOfRequest(request);
  if (url !== undefined) return cut(safeUrl(url));
  return cut(queryOfRequest(request) ?? request.summary);
}

const FACET_MAX = 1000;

function facet(input: unknown, key: string): Record<string, string> {
  const value = inputText(input, key);
  return value === undefined ? {} : { [key]: value.length > FACET_MAX ? value.slice(0, FACET_MAX) : value };
}

/** The request with only the parts rules look at (short strings), cheap to keep around. */
export function compactRequest(request: RuleRequest): RuleRequest {
  const { input } = request;
  return {
    toolName: request.toolName,
    summary: request.summary.slice(0, FACET_MAX),
    input: {
      ...facet(input, 'command'),
      ...facet(input, 'file_path'),
      ...facet(input, 'notebook_path'),
      ...facet(input, 'path'),
      ...facet(input, 'url'),
      ...facet(input, 'query'),
    },
    ...(request.projectPath !== undefined ? { projectPath: request.projectPath } : {}),
    ...(request.accountId !== undefined ? { accountId: request.accountId } : {}),
  };
}
