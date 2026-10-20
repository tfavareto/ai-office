// "Looks like" key of a permission request: requests with the same key can be approved together.
// Shell commands must be identical (after folding whitespace); file tools match by folder and extension; web
// fetches by host. Everything else matches on the exact summary.
import type { PermissionRequest } from '@ai-office/shared';
import { commandOf, filePathOf } from './permission-risk';

type PatternInput = Pick<PermissionRequest, 'toolName' | 'input' | 'summary'>;

const FILE_TOOLS: ReadonlySet<string> = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function fold(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function urlHost(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const url = (input as Record<string, unknown>).url;
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function filePattern(path: string): string {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  return `${dir}*${dot > 0 ? name.slice(dot) : ''}`;
}

/** Human readable form of the key: what the whole group has in common ("npm test", "src/*.ts", "docs.stripe.com"). */
export function similarityLabel(permission: PatternInput): string {
  if (permission.toolName === 'Bash') return fold(commandOf(permission) || permission.summary);
  const path = filePathOf(permission);
  if (FILE_TOOLS.has(permission.toolName) && path !== undefined) return filePattern(path);
  const host = urlHost(permission.input);
  if (permission.toolName === 'WebFetch' && host !== undefined) return host;
  return fold(permission.summary);
}

export function similarityKey(permission: PatternInput): string {
  return `${permission.toolName}|${similarityLabel(permission)}`;
}
