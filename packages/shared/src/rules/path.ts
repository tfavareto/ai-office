// POSIX path helpers and a small glob matcher for approval rules. Pure text: nothing touches the file system (symlinks
// are not resolved), so a rule judges the path the agent asked for.

export const MAX_PATH_LENGTH = 1000;
/** Segments of a glob or path that are looked at (a longer one never matches). */
const MAX_SEGMENTS = 64;

export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/');
}

/** Collapses `.`, `..` and repeated slashes. A relative path may keep leading `..`; an absolute one never escapes `/`. */
export function normalizePath(path: string): string {
  const absolute = isAbsolutePath(path);
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..') out.push(part);
    else if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else if (!absolute) out.push('..');
  }
  return `${absolute ? '/' : ''}${out.join('/')}` || (absolute ? '/' : '.');
}

/** Absolute form of `path`, relative to `base` when it has one (a relative path with no base stays relative). */
export function resolvePath(path: string, base?: string): string {
  if (isAbsolutePath(path) || base === undefined || !isAbsolutePath(base)) return normalizePath(path);
  return normalizePath(`${base}/${path}`);
}

export function pathSegments(path: string): string[] {
  return path.split('/').filter((part) => part.length > 0);
}

/** True when the path (or glob) goes through a `..` segment. */
export function hasParentSegment(path: string): boolean {
  return pathSegments(path).includes('..');
}

/** Leading segments of a glob that have no wildcard: the folder it is anchored in. */
export function staticBase(glob: string): string[] {
  const base: string[] = [];
  for (const part of pathSegments(glob)) {
    if (/[*?]/.test(part)) break;
    base.push(part);
  }
  return base;
}

/** `*` and `?` inside one name; a name starting with a wildcard never matches a dot file (like a shell without dotglob). */
function matchName(pattern: string, name: string): boolean {
  if (/^[*?]/.test(pattern) && name.startsWith('.')) return false;
  let p = 0;
  let n = 0;
  let star = -1;
  let resume = 0;
  while (n < name.length) {
    const code = pattern[p];
    if (code === '*') {
      star = p++;
      resume = n;
    } else if (code === '?' || code === name[n]) {
      p++;
      n++;
    } else if (star >= 0) {
      p = star + 1;
      n = ++resume;
    } else {
      return false;
    }
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}

function matchSegments(pattern: readonly string[], parts: readonly string[], pi: number, si: number): boolean {
  if (pi === pattern.length) return si === parts.length;
  const current = pattern[pi] as string;
  if (current === '**') {
    // Zero or more folders, none of them hidden.
    for (let end = si; end <= parts.length; end++) {
      if (matchSegments(pattern, parts, pi + 1, end)) return true;
      if (end < parts.length && (parts[end] as string).startsWith('.')) return false;
    }
    return false;
  }
  return si < parts.length && matchName(current, parts[si] as string) && matchSegments(pattern, parts, pi + 1, si + 1);
}

/**
 * Whether `path` matches `glob`. Both are normalized first; a relative glob is anchored in `base` (the project).
 * `**` spans folders, `*` and `?` stay inside a name, and neither matches a name that starts with a dot.
 */
export function globMatches(glob: string, path: string, base?: string): boolean {
  if (glob.length > MAX_PATH_LENGTH || path.length > MAX_PATH_LENGTH) return false;
  const pattern = pathSegments(resolvePath(glob, base));
  const parts = pathSegments(resolvePath(path, base));
  if (pattern.length > MAX_SEGMENTS || parts.length > MAX_SEGMENTS) return false;
  if (isAbsolutePath(resolvePath(glob, base)) !== isAbsolutePath(resolvePath(path, base))) return false;
  return matchSegments(pattern, parts, 0, 0);
}
