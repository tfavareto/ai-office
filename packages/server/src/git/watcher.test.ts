import { beforeEach, describe, expect, test } from 'vitest';
import { silentLogger } from '../log';
import { RunError, type Runner } from './run';
import {
  ACTIVE_REFRESH_MS,
  GitWatcher,
  IDLE_REFRESH_MS,
  MAX_CONCURRENT_READS,
  PR_REFRESH_MS,
  TOUCH_DEBOUNCE_MS,
  TOUCH_MAX_WAIT_MS,
  UNAVAILABLE_RETRY_MS,
  type WatchedProject,
} from './watcher';

const OID = '0123456789abcdef0123456789abcdef01234567';
const statusOf = (branch: string, extra = ''): string => `# branch.oid ${OID}\n# branch.head ${branch}\n${extra}`;
const PR_JSON = JSON.stringify({ number: 7, title: 'T', state: 'OPEN', url: 'https://github.com/o/r/pull/7', statusCheckRollup: [] });

interface Harness {
  watcher: GitWatcher;
  clock: { now: number };
  rooms: WatchedProject[];
  branches: Map<string, string>;
  gitCalls: { path: string; sub: string }[];
  ghCalls: string[];
  changes: { count: number };
  setPullRequests(on: boolean): void;
  failGit(error: Error | undefined): void;
  failGh(error: Error | undefined): void;
  /** Advances the clock and runs one tick, then waits for the reads to finish. */
  step(ms: number): Promise<void>;
  maxConcurrent(): number;
}

function harness(rooms: WatchedProject[], options: { hasRepository?: (path: string) => boolean } = {}): Harness {
  const clock = { now: 1_000_000 };
  const branches = new Map(rooms.map((room) => [room.path, 'main']));
  const gitCalls: Harness['gitCalls'] = [];
  const ghCalls: string[] = [];
  const changes = { count: 0 };
  let pullRequests = false;
  let gitFailure: Error | undefined;
  let ghFailure: Error | undefined;
  let inFlight = 0;
  let peak = 0;
  const runGit: Runner = async (_file, args, run) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    inFlight--;
    const sub = args.find((arg) => ['status', 'diff', 'log', 'stash'].includes(arg)) ?? '';
    gitCalls.push({ path: run.cwd, sub });
    if (gitFailure !== undefined) throw gitFailure;
    return sub === 'status' ? statusOf(branches.get(run.cwd) ?? 'main') : '';
  };
  const runGh: Runner = (_file, _args, run) => {
    ghCalls.push(run.cwd);
    return ghFailure === undefined ? Promise.resolve(PR_JSON) : Promise.reject(ghFailure);
  };
  const watcher = new GitWatcher({
    runGit,
    runGh,
    now: () => clock.now,
    log: silentLogger,
    projects: () => rooms,
    pullRequestsEnabled: () => pullRequests,
    onChange: () => changes.count++,
    hasRepository: (path) => Promise.resolve(options.hasRepository?.(path) ?? true),
  });
  return {
    watcher,
    clock,
    rooms,
    branches,
    gitCalls,
    ghCalls,
    changes,
    setPullRequests: (on) => {
      pullRequests = on;
    },
    failGit: (error) => {
      gitFailure = error;
    },
    failGh: (error) => {
      ghFailure = error;
    },
    async step(ms) {
      clock.now += ms;
      watcher.tick();
      await watcher.idle();
    },
    maxConcurrent: () => peak,
  };
}

const room = (name: string, active = false): WatchedProject => ({ id: `/work/${name}`, path: `/work/${name}`, active });
const statusReads = (h: Harness, path?: string): number => h.gitCalls.filter((call) => call.sub === 'status' && (path === undefined || call.path === path)).length;

let h: Harness;
beforeEach(() => {
  h = harness([room('a', true), room('b')]);
});

describe('first read', () => {
  test('reads every room once, publishes the change and exposes the state', async () => {
    // Act
    await h.step(0);
    // Assert
    expect(statusReads(h)).toBe(2);
    expect(h.watcher.get('/work/a')).toMatchObject({ branch: 'main' });
    expect(h.changes.count).toBe(2);
  });

  test('does not run anything for a folder that is not a repository', async () => {
    // Arrange
    h = harness([room('plain')], { hasRepository: () => false });
    // Act
    await h.step(0);
    // Assert
    expect(h.gitCalls).toEqual([]);
    expect(h.watcher.get('/work/plain')).toBeUndefined();
    expect(h.changes.count).toBe(0);
  });

  test('never reads more than two repositories at the same time', async () => {
    // Arrange
    h = harness(['a', 'b', 'c', 'd', 'e', 'f'].map((name) => room(name)));
    // Act
    await h.step(0);
    // Assert
    expect(statusReads(h)).toBe(6);
    expect(h.maxConcurrent()).toBeLessThanOrEqual(MAX_CONCURRENT_READS);
  });
});

describe('refresh schedule', () => {
  test('rooms with active agents refresh every 30 s, the others every 5 minutes', async () => {
    // Arrange
    await h.step(0);
    // Act + Assert
    await h.step(ACTIVE_REFRESH_MS - 1);
    expect(statusReads(h, '/work/a')).toBe(1);
    await h.step(1);
    expect(statusReads(h, '/work/a')).toBe(2);
    expect(statusReads(h, '/work/b')).toBe(1);
    await h.step(IDLE_REFRESH_MS - ACTIVE_REFRESH_MS);
    expect(statusReads(h, '/work/b')).toBe(2);
  });

  test('does not publish when nothing changed, and does when the branch did', async () => {
    // Arrange
    await h.step(0);
    const before = h.changes.count;
    // Act + Assert
    await h.step(ACTIVE_REFRESH_MS);
    expect(h.changes.count).toBe(before);
    h.branches.set('/work/a', 'feat/y');
    await h.step(ACTIVE_REFRESH_MS);
    expect(h.changes.count).toBe(before + 1);
    expect(h.watcher.get('/work/a')?.branch).toBe('feat/y');
  });

  test('a touch triggers a read after the debounce, not before', async () => {
    // Arrange
    await h.step(0);
    h.watcher.touch('/work/b');
    // Act + Assert
    await h.step(TOUCH_DEBOUNCE_MS - 1);
    expect(statusReads(h, '/work/b')).toBe(1);
    await h.step(1);
    expect(statusReads(h, '/work/b')).toBe(2);
  });

  test('a stream of touches still reads at the maximum wait', async () => {
    // Arrange
    await h.step(0);
    // Act: a touch every second keeps postponing the debounce
    for (let elapsed = 0; elapsed < TOUCH_MAX_WAIT_MS; elapsed += 1000) {
      h.watcher.touch('/work/b');
      await h.step(1000);
    }
    // Assert
    expect(statusReads(h, '/work/b')).toBe(2);
  });

  test('ignores a touch for a room it does not know', async () => {
    await h.step(0);
    h.watcher.touch('/work/unknown');
    await h.step(TOUCH_DEBOUNCE_MS);
    expect(h.gitCalls.every((call) => call.path !== '/work/unknown')).toBe(true);
  });

  test('forgets a room that left', async () => {
    // Arrange
    await h.step(0);
    const changesBefore = h.changes.count;
    // Act
    h.rooms.splice(0, 1);
    await h.step(1000);
    // Assert
    expect(h.watcher.get('/work/a')).toBeUndefined();
    expect(h.changes.count).toBe(changesBefore + 1);
  });
});

describe('failures', () => {
  test('keeps the last state through a timeout and drops it after three failures in a row', async () => {
    // Arrange
    await h.step(0);
    h.failGit(new RunError('timeout', undefined, '', true));
    // Act + Assert
    await h.step(ACTIVE_REFRESH_MS);
    await h.step(ACTIVE_REFRESH_MS);
    expect(h.watcher.get('/work/a')).toBeDefined();
    await h.step(ACTIVE_REFRESH_MS);
    expect(h.watcher.get('/work/a')).toBeUndefined();
  });

  test('when git is not installed it stops trying for a while, then tries again', async () => {
    // Arrange
    h.failGit(new RunError('spawn git ENOENT', 'ENOENT', '', false));
    await h.step(0);
    const attempts = statusReads(h);
    // Act + Assert
    expect(h.watcher.get('/work/a')).toBeUndefined();
    await h.step(ACTIVE_REFRESH_MS * 3);
    expect(statusReads(h)).toBe(attempts);
    h.failGit(undefined);
    await h.step(UNAVAILABLE_RETRY_MS);
    expect(h.watcher.get('/work/a')).toBeDefined();
  });

  test('does not stop the watcher when the reader throws something unexpected', async () => {
    // Arrange
    h.failGit(new Error('weird'));
    // Act + Assert
    await expect(h.step(0)).resolves.toBeUndefined();
    h.failGit(undefined);
    await h.step(ACTIVE_REFRESH_MS);
    expect(h.watcher.get('/work/a')).toBeDefined();
  });
});

describe('pull requests', () => {
  test('never start gh while they are off', async () => {
    await h.step(0);
    await h.step(PR_REFRESH_MS * 3);
    expect(h.ghCalls).toEqual([]);
    expect(h.watcher.get('/work/a')?.pr).toBeUndefined();
    expect(h.watcher.ghStatus()).toBe('unknown');
  });

  test('ask gh for each branch once the person turned them on, and again every two minutes', async () => {
    // Arrange
    await h.step(0);
    h.setPullRequests(true);
    // Act + Assert
    await h.step(1000);
    expect(h.ghCalls.sort()).toEqual(['/work/a', '/work/b']);
    expect(h.watcher.get('/work/a')?.pr).toMatchObject({ number: 7, state: 'open' });
    expect(h.watcher.ghStatus()).toBe('ready');
    await h.step(PR_REFRESH_MS - 1);
    expect(h.ghCalls).toHaveLength(2);
    await h.step(1);
    expect(h.ghCalls).toHaveLength(4);
  });

  test('look again at once when the branch changes, and hide a pull request of another branch', async () => {
    // Arrange
    h.setPullRequests(true);
    await h.step(0);
    await h.step(1000);
    const calls = h.ghCalls.length;
    // Act
    h.branches.set('/work/a', 'other');
    await h.step(ACTIVE_REFRESH_MS);
    await h.step(1000);
    // Assert
    expect(h.ghCalls.length).toBeGreaterThan(calls);
  });

  test('turning them off hides them and publishes', async () => {
    // Arrange
    h.setPullRequests(true);
    await h.step(0);
    await h.step(1000);
    const changes = h.changes.count;
    // Act
    h.setPullRequests(false);
    await h.step(1000);
    // Assert
    expect(h.watcher.get('/work/a')?.pr).toBeUndefined();
    expect(h.changes.count).toBeGreaterThan(changes);
  });

  test('a missing gh is remembered and not retried for ten minutes', async () => {
    // Arrange
    h.failGh(new RunError('spawn gh ENOENT', 'ENOENT', '', false));
    h.setPullRequests(true);
    // Act
    await h.step(0);
    await h.step(1000);
    const calls = h.ghCalls.length;
    await h.step(PR_REFRESH_MS * 2);
    // Assert
    expect(h.watcher.ghStatus()).toBe('missing');
    expect(h.ghCalls).toHaveLength(calls);
    expect(h.watcher.get('/work/a')?.pr).toBeUndefined();
    await h.step(UNAVAILABLE_RETRY_MS);
    expect(h.ghCalls.length).toBeGreaterThan(calls);
  });

  test('a branch with no pull request has none and keeps the room readable', async () => {
    // Arrange
    h.failGh(new RunError('failed', 1, 'no pull requests found for branch "main"', false));
    h.setPullRequests(true);
    // Act
    await h.step(0);
    await h.step(1000);
    // Assert
    expect(h.watcher.get('/work/a')).toMatchObject({ branch: 'main' });
    expect(h.watcher.get('/work/a')?.pr).toBeUndefined();
    expect(h.watcher.ghStatus()).toBe('ready');
  });

  test('a detached HEAD is never looked up', async () => {
    // Arrange
    h.branches.set('/work/a', '(detached)');
    h.setPullRequests(true);
    // Act
    await h.step(0);
    await h.step(1000);
    // Assert
    expect(h.ghCalls).toEqual(['/work/b']);
  });
});

describe('stop', () => {
  test('ticks do nothing after it', async () => {
    h.watcher.stop();
    await h.step(0);
    expect(h.gitCalls).toEqual([]);
  });
});
