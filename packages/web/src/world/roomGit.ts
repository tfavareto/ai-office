// What the worlds draw of a room's repository: the branch on a plaque under the sign, a marker for uncommitted work and
// operations in progress, and a small CI light when the branch has an open pull request. Pure: no canvas, no language
// (the words of the 3D plaque come from the world catalog).
import { ciLight, gitRef, isDirty, type CiState, type GitOperation, type ProjectGit } from '@ai-office/shared';

export interface RoomGit {
  /** Branch, or the abbreviated commit of a detached HEAD. */
  ref: string;
  detached: boolean;
  dirty: boolean;
  /** Files with conflicts. */
  conflicted: boolean;
  ahead: number;
  behind: number;
  op: GitOperation | null;
  ci: CiState;
}

export function roomGit(git: ProjectGit | undefined): RoomGit | undefined {
  if (git === undefined) return undefined;
  const ref = gitRef(git);
  if (ref === '') return undefined;
  return {
    ref,
    detached: git.detached === true,
    dirty: isDirty(git),
    conflicted: git.conflicted > 0,
    ahead: git.ahead ?? 0,
    behind: git.behind ?? 0,
    op: git.op ?? null,
    ci: ciLight(git),
  };
}

/** Changes whenever something the plaque draws changes (cache key of the painted plaque). */
export function roomGitKey(info: RoomGit): string {
  return `${info.ref}|${info.detached ? 'd' : ''}${info.dirty ? 'x' : ''}${info.conflicted ? 'c' : ''}|${info.ahead}|${info.behind}|${info.op ?? ''}|${info.ci}`;
}

/** How worrying the repository looks: calm, uncommitted work, or something that needs a hand. */
export type PlaqueTone = 'clean' | 'dirty' | 'alert';

export function plaqueTone(info: RoomGit): PlaqueTone {
  if (info.conflicted || info.op !== null) return 'alert';
  return info.dirty ? 'dirty' : 'clean';
}

export const PLAQUE_COLORS = { clean: '#3ecf8e', dirty: '#f5b544', alert: '#ef6b6b' } as const satisfies Record<PlaqueTone, string>;
export const CI_COLORS = { success: '#3ecf8e', failure: '#ef6b6b', pending: '#f5b544' } as const;

const PILL_BRANCH_MAX = 24;

/** The detail of a room pill while the room is hovered or selected: the branch, starred when work is uncommitted. */
export function pillBranch(info: RoomGit): string {
  return `${fitBranch(info.ref, PILL_BRANCH_MAX, '…')}${info.dirty ? ' *' : ''}`;
}

/**
 * A branch name that fits in `maxChars` characters: whole when it fits, else without its first segment
 * (`feat/cupom` becomes `cupom`), else cut with `ellipsis`.
 */
export function fitBranch(branch: string, maxChars: number, ellipsis: string): string {
  if (maxChars <= 0) return '';
  if (branch.length <= maxChars) return branch;
  const slash = branch.indexOf('/');
  const tail = slash >= 0 && slash < branch.length - 1 ? branch.slice(slash + 1) : branch;
  if (tail.length <= maxChars) return tail;
  const keep = maxChars - ellipsis.length;
  if (keep <= 0) return ellipsis.length <= maxChars ? ellipsis : '';
  return `${tail.slice(0, keep)}${ellipsis}`;
}
