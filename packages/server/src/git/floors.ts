// Floors: a checkout of its own for each task, on its own branch, so agents working in parallel never step on each
// other. This is the one part of the office that writes to repositories, and only when the person clicks. A floor lives
// in `<repo>-floors/<name>`, next to the repository, and only folders there count as floors: anything else, including
// worktrees the person made, is never landed or removed. The repository's hooks do not run, because a repository could
// carry them, and no path comes from the page: it always starts from a room of the office.
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { BASE_ARGS } from './read-state';
import { RunError, type Runner } from './run';

const WRITE_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 5000;
/** Prefix of every command here: the usual reads' protections, and no hooks. */
const ARGS = [...BASE_ARGS, '-c', 'core.hooksPath=/dev/null'] as const;
const MAX_NAME = 48;
const CONFLICT_FILE_LIMIT = 20;
/** A large folder of dependencies takes a while to delete, and a killed removal would leave half of it behind. */
const REMOVE_TIMEOUT_MS = 180_000;
/**
 * Settings in the repository's own configuration that make git run a program during what is done here. A clone cannot
 * carry them, but an agent can write them, and this server runs outside whatever limits that agent has: a click on
 * merge must not become the trigger. The person's global configuration is theirs and stays trusted.
 */
const UNSAFE_CONFIG =
  '^(filter|merge)\\..*\\.(smudge|clean|process|driver)$|^core\\.(sshcommand|alternaterefscommand|pager|askpass)$|^gpg\\.(.*\\.)?program$|^credential\\.|^diff\\.external$';

export type FloorErrorCode =
  | 'invalid-name'
  | 'not-a-repository'
  | 'unsafe-config'
  | 'floor-exists'
  | 'not-a-floor'
  | 'floor-detached'
  | 'floor-dirty'
  | 'floor-has-ignored'
  | 'target-dirty'
  | 'target-busy'
  | 'nothing-to-land'
  | 'floor-conflict'
  | 'git-failed';

export class FloorError extends Error {
  constructor(
    readonly code: FloorErrorCode,
    readonly files: readonly string[] = [],
  ) {
    super(code);
    this.name = 'FloorError';
  }
}

export type FloorStatus =
  | { isFloor: false }
  | {
      isFloor: true;
      branch: string;
      target: string;
      ahead: number;
      dirty: boolean;
      /** The floor or the repository is not on a branch: nothing can be landed or removed safely. */
      detached: boolean;
      repo: string;
      path: string;
    };

/** A safe folder and branch name from what the person typed; null when nothing usable is left. */
export function slugifyFloor(name: string): string | null {
  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME)
    .replace(/-+$/g, '');
  return slug === '' ? null : slug;
}

function floorsDirOf(repo: string): string {
  return `${repo}-floors`;
}

function git(run: Runner, cwd: string, args: readonly string[], timeoutMs = READ_TIMEOUT_MS): Promise<string> {
  return run('git', [...ARGS, ...args], { cwd, timeoutMs });
}

/** `git config` answers with an error when nothing matches, which is the good case. */
async function assertSafeConfig(run: Runner, repo: string): Promise<void> {
  const found = await git(run, repo, ['config', '--local', '--name-only', '--get-regexp', UNSAFE_CONFIG]).catch(
    () => '',
  );
  if (found.trim() !== '') throw new FloorError('unsafe-config');
}

/** The checkout's own branch; empty when it is not on one. */
function branchOf(run: Runner, cwd: string): Promise<string> {
  return git(run, cwd, ['symbolic-ref', '-q', '--short', 'HEAD'])
    .then((text) => text.trim())
    .catch(() => '');
}

/** Everything not committed, whatever the configuration hides. Ignored files are asked about separately. */
async function isDirty(run: Runner, cwd: string): Promise<boolean> {
  return (await git(run, cwd, ['status', '--porcelain', '--untracked-files=all'])).trim() !== '';
}

export async function createFloor(
  run: Runner,
  roomPath: string,
  name: string,
): Promise<{ path: string; branch: string }> {
  const slug = slugifyFloor(name);
  if (slug === null) throw new FloorError('invalid-name');
  const top = (await git(run, roomPath, ['rev-parse', '--show-toplevel']).catch(() => '')).trim();
  const common = (
    await git(run, roomPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']).catch(() => '')
  ).trim();
  // Only a repository's main checkout: a floor made from a submodule or another worktree could never be landed.
  if (top === '' || basename(common) !== '.git' || dirname(common) !== top) throw new FloorError('not-a-repository');
  await assertSafeConfig(run, top);
  const path = join(floorsDirOf(top), slug);
  const branch = `floor/${slug}`;
  await mkdir(floorsDirOf(top), { recursive: true });
  try {
    await git(run, top, ['worktree', 'add', '-q', '-b', branch, path], WRITE_TIMEOUT_MS);
  } catch (error) {
    const text = error instanceof RunError ? error.stderr : '';
    if (!/already (exists|used)/i.test(text)) throw new FloorError('git-failed');
    // Still empty: probably a hire that failed after creating it, so trying again just works.
    const status = await floorStatus(run, path);
    if (status.isFloor && status.branch === branch && status.ahead === 0 && !status.dirty) return { path, branch };
    throw new FloorError('floor-exists');
  }
  return { path, branch };
}

export async function floorStatus(run: Runner, path: string): Promise<FloorStatus> {
  try {
    const top = (await git(run, path, ['rev-parse', '--show-toplevel'])).trim();
    const common = (await git(run, path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
    const repo = dirname(common);
    if (top === repo || dirname(top) !== floorsDirOf(repo) || basename(common) !== '.git') return { isFloor: false };
    const branch = await branchOf(run, top);
    const target = await branchOf(run, repo);
    const detached = branch === '' || target === '';
    const dirty = await isDirty(run, top);
    const ahead = detached ? 0 : Number((await git(run, top, ['rev-list', '--count', `${target}..${branch}`])).trim());
    return {
      isFloor: true,
      branch,
      target,
      ahead: Number.isFinite(ahead) ? ahead : 0,
      dirty,
      detached,
      repo,
      path: top,
    };
  } catch {
    return { isFloor: false };
  }
}

async function floorOrThrow(run: Runner, path: string): Promise<Extract<FloorStatus, { isFloor: true }>> {
  const status = await floorStatus(run, path);
  if (!status.isFloor) throw new FloorError('not-a-floor');
  return status;
}

/** Merges the floor's branch into the branch the repository has checked out; a conflict undoes itself. */
export async function landFloorByMerge(run: Runner, path: string): Promise<void> {
  const status = await floorOrThrow(run, path);
  if (status.detached) throw new FloorError('floor-detached');
  if (status.dirty) throw new FloorError('floor-dirty');
  if (status.ahead === 0) throw new FloorError('nothing-to-land');
  await assertSafeConfig(run, status.repo);
  if (await isDirty(run, status.repo)) throw new FloorError('target-dirty');
  // The person's own merge in progress is theirs: a failure below would otherwise abort it.
  const merging = await git(run, status.repo, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
    .then(() => true)
    .catch(() => false);
  if (merging) throw new FloorError('target-busy');
  try {
    await git(
      run,
      status.repo,
      ['-c', 'commit.gpgSign=false', 'merge', '--no-ff', '--no-edit', status.branch],
      WRITE_TIMEOUT_MS,
    );
  } catch {
    const files = (await git(run, status.repo, ['diff', '--name-only', '--diff-filter=U']).catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .slice(0, CONFLICT_FILE_LIMIT);
    await git(run, status.repo, ['merge', '--abort'], WRITE_TIMEOUT_MS).catch(() => '');
    throw new FloorError(files.length > 0 ? 'floor-conflict' : 'git-failed', files);
  }
}

/** Publishes the branch and opens a pull request with the person's own `gh`. `runGh` has their environment. */
export async function landFloorByPullRequest(run: Runner, runGh: Runner, path: string): Promise<string> {
  const status = await floorOrThrow(run, path);
  if (status.detached) throw new FloorError('floor-detached');
  if (status.dirty) throw new FloorError('floor-dirty');
  if (status.ahead === 0) throw new FloorError('nothing-to-land');
  await assertSafeConfig(run, status.repo);
  try {
    await runGh('git', [...ARGS, 'push', '-u', 'origin', status.branch], {
      cwd: status.path,
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    const output = await runGh('gh', ['pr', 'create', '--fill', '--base', status.target], {
      cwd: status.path,
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    return output.trim().split('\n').pop() ?? '';
  } catch {
    throw new FloorError('git-failed');
  }
}

/**
 * Removes the folder; the branch goes too only if nothing would be lost. Ignored files (`.env`, dependencies, local
 * databases) go with the folder and no status mentions them, so the person has to accept that first.
 */
export async function removeFloor(
  run: Runner,
  path: string,
  options: { acceptIgnored?: boolean } = {},
): Promise<{ branchKept: boolean }> {
  const status = await floorOrThrow(run, path);
  if (status.branch === '') throw new FloorError('floor-detached');
  if (status.dirty) throw new FloorError('floor-dirty');
  const listing = await git(run, status.path, ['status', '--porcelain', '--ignored', '--untracked-files=normal']);
  const hasIgnored = listing.split('\n').some((line) => line.startsWith('!!'));
  if (hasIgnored && options.acceptIgnored !== true) throw new FloorError('floor-has-ignored');
  try {
    await git(run, status.repo, ['worktree', 'remove', '--', status.path], REMOVE_TIMEOUT_MS);
  } catch {
    throw new FloorError('git-failed');
  }
  const deleted = await git(run, status.repo, ['branch', '-d', status.branch], WRITE_TIMEOUT_MS)
    .then(() => true)
    .catch(() => false);
  return { branchKept: !deleted };
}
