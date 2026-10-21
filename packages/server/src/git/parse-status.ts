// Parsers for the output of read-only git commands. Pure functions: every input is data, never trusted.
import { GIT_BRANCH_MAX, GIT_SUBJECT_MAX, type GitCommit } from '@ai-office/shared';

export interface ParsedStatus {
  /** Branch name; undefined when HEAD is detached. */
  branch?: string;
  detached: boolean;
  /** Abbreviated commit HEAD points at; undefined on a branch with no commit yet. */
  head?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

const HEAD_ABBREV = 7;
const AHEAD_BEHIND = /^\+(\d+) -(\d+)$/;
/** XY of a changed entry: `.` means unchanged on that side. */
const CHANGE_FIELD = /^[12] (.)(.) /;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;

function cleanRef(value: string): string {
  return value.replace(CONTROL, '').slice(0, GIT_BRANCH_MAX);
}

/**
 * Parses `status --porcelain=v2 --branch` (without -z). The ahead/behind pair comes from `# branch.ab`, which git
 * only prints when the branch has an upstream, so it is exactly `rev-list --left-right --count @{u}...HEAD`.
 */
export function parseStatus(output: string): ParsedStatus {
  const status: ParsedStatus = { detached: false, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  for (const line of output.split('\n')) {
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice('# branch.oid '.length).trim();
      if (/^[0-9a-f]{7,64}$/.test(oid)) status.head = oid.slice(0, HEAD_ABBREV);
    } else if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      if (head === '(detached)') status.detached = true;
      else if (head.length > 0) status.branch = cleanRef(head);
    } else if (line.startsWith('# branch.upstream ')) {
      const upstream = cleanRef(line.slice('# branch.upstream '.length).trim());
      if (upstream.length > 0) status.upstream = upstream;
    } else if (line.startsWith('# branch.ab ')) {
      const match = AHEAD_BEHIND.exec(line.slice('# branch.ab '.length).trim());
      if (match !== null) {
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
    } else if (line.startsWith('? ')) {
      status.untracked++;
    } else if (line.startsWith('u ')) {
      status.conflicted++;
    } else {
      const match = CHANGE_FIELD.exec(line);
      if (match === null) continue;
      if (match[1] !== '.') status.staged++;
      if (match[2] !== '.') status.unstaged++;
    }
  }
  return status;
}

/** Parses `diff --shortstat`: ` 3 files changed, 10 insertions(+), 2 deletions(-)`; empty output means no changes. */
export function parseShortstat(output: string): { insertions: number; deletions: number } {
  const insertions = /(\d+) insertions?\(\+\)/.exec(output);
  const deletions = /(\d+) deletions?\(-\)/.exec(output);
  return {
    insertions: insertions === null ? 0 : Number(insertions[1]),
    deletions: deletions === null ? 0 : Number(deletions[1]),
  };
}

/** Parses `log -1 --format=%h%x09%ct%x09%s` (tab separated: hash, unix seconds, subject). */
export function parseLastCommit(output: string): GitCommit | undefined {
  const line = output.split('\n')[0] ?? '';
  const first = line.indexOf('\t');
  const second = first < 0 ? -1 : line.indexOf('\t', first + 1);
  if (second < 0) return undefined;
  const hash = line.slice(0, first);
  const seconds = Number(line.slice(first + 1, second));
  if (!/^[0-9a-f]{4,64}$/.test(hash) || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const subject = line
    .slice(second + 1)
    .replace(CONTROL, ' ')
    .trim()
    .slice(0, GIT_SUBJECT_MAX);
  return { hash: hash.slice(0, 12), subject, at: seconds * 1000 };
}

/** Parses several lines of `log --format=%h%x09%ct%x09%s`; lines that are not commits are skipped. */
export function parseCommitLog(output: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const line of output.split('\n')) {
    const commit = parseLastCommit(line);
    if (commit !== undefined) commits.push(commit);
  }
  return commits;
}

/** Counts the entries of `stash list`. */
export function countStash(output: string): number {
  return output.split('\n').filter((line) => line.trim().length > 0).length;
}
