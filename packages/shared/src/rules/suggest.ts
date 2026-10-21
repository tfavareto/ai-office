// "Create rule…": a rule pre-filled from a permission request — the tool, the normalized command prefix or folder glob,
// this project. The user edits it before saving.
import { detectRisk } from '../permission-risk';
import { commandSegments, commandTokens, isSimpleCommand } from './command';
import { isAbsolutePath, normalizePath, pathSegments, resolvePath } from './path';
import { type RuleDraft } from './validate';
import { type RuleRequest, commandOfRequest, hostOfUrl, isFileTool, pathOfRequest, urlOfRequest } from './request';

const PACKAGE_RUNNERS: readonly string[] = ['npm', 'pnpm', 'yarn', 'bun'];
const RUN_WORDS: readonly string[] = ['run', 'exec', 'dlx'];

/** The words that name what a command does: `npm test`, `npm run build`, `git status`, `ls`. */
export function commandPrefixOf(command: string): string {
  const words = commandTokens(commandSegments(command)[0] ?? command);
  const [first = '', second = '', third = ''] = words;
  if (words.length === 0) return '';
  const isOption = second.startsWith('-') || second.includes('/') || second.includes('.') || second === '';
  if (isOption) return first;
  if (PACKAGE_RUNNERS.includes(first) && RUN_WORDS.includes(second) && third !== '' && !third.startsWith('-')) return `${first} ${second} ${third}`;
  return `${first} ${second}`;
}

/** Folder glob of a file: `src/**` inside the project, `*.md` for a file at its root, an absolute folder outside it. */
export function folderGlobOf(path: string, projectPath?: string): string {
  const absolute = resolvePath(path, projectPath);
  const root = projectPath === undefined ? undefined : normalizePath(projectPath);
  const parts = pathSegments(absolute);
  const dir = parts.slice(0, -1);
  if (root !== undefined && isAbsolutePath(absolute) && (absolute === root || absolute.startsWith(`${root}/`))) {
    const inside = dir.slice(pathSegments(root).length);
    if (inside.length > 0) return `${inside.join('/')}/**`;
    const extension = /\.[A-Za-z0-9]+$/.exec(parts[parts.length - 1] ?? '')?.[0];
    return extension === undefined ? '*' : `*${extension}`;
  }
  return `${isAbsolutePath(absolute) ? '/' : ''}${dir.join('/')}/**`;
}

/**
 * The rule a request suggests. Risky requests suggest a deny rule (an allow rule would be refused anyway); everything
 * else suggests allow. The scope is the request's project.
 */
export function suggestRule(request: RuleRequest): RuleDraft {
  const risky = detectRisk({ toolName: request.toolName, input: request.input, summary: request.summary }) !== null;
  const base = { effect: risky ? ('deny' as const) : ('allow' as const), tool: request.toolName, scope: { ...(request.projectPath !== undefined ? { projectPath: request.projectPath } : {}) }, enabled: true };
  const command = commandOfRequest(request);
  if (request.toolName === 'Bash' && command !== undefined) {
    const prefix = commandPrefixOf(command);
    return { ...base, matcher: isSimpleCommand(command) && prefix !== '' ? { kind: 'command-prefix', value: prefix } : { kind: 'exact', value: command.trim() } };
  }
  const path = pathOfRequest(request);
  if (isFileTool(request.toolName) && path !== undefined) return { ...base, matcher: { kind: 'path-glob', value: folderGlobOf(path, request.projectPath) } };
  const url = urlOfRequest(request);
  const host = url === undefined ? undefined : hostOfUrl(url)?.hostname;
  if (host !== undefined) return { ...base, matcher: { kind: 'host', value: host } };
  return { ...base, matcher: { kind: 'any', value: '' } };
}
