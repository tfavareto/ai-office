import type { Activity, Agent, OfficeSnapshot } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { isCommitCommand, isTestCommand, roomMilestone, TriggerTracker, STREAK_MS } from './triggers';
import { makeAgent, makeSnapshot } from './testkit';

let counter = 0;
const bash = (command: string): Activity => ({
  id: `a${counter++}`,
  at: counter * 1000,
  kind: 'bash',
  icon: '💻',
  text: command,
  detail: command,
});
const failure = (tool = 'Bash'): Activity => ({
  id: `a${counter++}`,
  at: counter * 1000,
  kind: 'error',
  icon: '⚠️',
  text: 'erro',
  msg: { key: 'activity.error', params: { tool } },
  error: true,
});
const edit = (): Activity => ({ id: `a${counter++}`, at: counter * 1000, kind: 'edit', icon: '✏️', text: 'edit' });

function snap(agents: Agent[], over: Partial<OfficeSnapshot> = {}): OfficeSnapshot {
  return { ...makeSnapshot(1, agents), ...over };
}

function withRecent(agent: Agent, recent: Activity[]): Agent {
  return { ...agent, recent, activity: recent[recent.length - 1] };
}

describe('command recognition', () => {
  it('recognises common test runners', () => {
    for (const c of [
      'npm test',
      'npm run test:unit',
      'pnpm test',
      'npx vitest run',
      'cd x && pytest -q',
      'go test ./...',
      'cargo test',
    ]) {
      expect(isTestCommand(c), c).toBe(true);
    }
    for (const c of ['npm run build', 'git status', 'ls tests', 'echo latest']) expect(isTestCommand(c), c).toBe(false);
  });

  it('recognises commits but not dry runs', () => {
    expect(isCommitCommand('git add . && git commit -m "x"')).toBe(true);
    expect(isCommitCommand('git commit --dry-run')).toBe(false);
    expect(isCommitCommand('git status')).toBe(false);
  });
});

describe('trigger tracker', () => {
  it('never fires on the first snapshot', () => {
    const tracker = new TriggerTracker();
    const done = makeAgent('ana', 0, 'idle', { tasks: [{ id: '1', title: 't', status: 'completed' }] });
    expect(tracker.update(snap([done]))).toEqual([]);
  });

  it('celebrates tests that pass after a failure, once the next activity shows they passed', () => {
    const tracker = new TriggerTracker();
    const base = makeAgent('ana', 0, 'working');
    tracker.update(snap([base]));
    const failed = withRecent(base, [bash('npm test'), failure()]);
    expect(tracker.update(snap([failed]))).toEqual([]);
    const rerun = withRecent(base, [...failed.recent, bash('npm test')]);
    expect(tracker.update(snap([rerun]))).toEqual([]);
    const next = withRecent(base, [...rerun.recent, edit()]);
    expect(tracker.update(snap([next]))).toEqual([{ kind: 'tests-fixed', agentId: 'ana', projectId: '/work/proj-0' }]);
  });

  it('does not celebrate tests that passed without failing first', () => {
    const tracker = new TriggerTracker();
    const base = makeAgent('ana', 0, 'working');
    tracker.update(snap([base]));
    const run = withRecent(base, [bash('npm test'), edit()]);
    expect(tracker.update(snap([run]))).toEqual([]);
  });

  it('ignores an error of another tool while a test result is pending', () => {
    const tracker = new TriggerTracker();
    const base = makeAgent('ana', 0, 'working');
    tracker.update(snap([base]));
    tracker.update(snap([withRecent(base, [bash('npm test'), failure()])]));
    const ok = withRecent(base, [bash('npm test'), failure(), bash('npm test'), failure('Edit'), edit()]);
    expect(tracker.update(snap([ok])).map((t) => t.kind)).toEqual(['tests-fixed']);
  });

  it('celebrates a commit that did not fail and not one that did', () => {
    const tracker = new TriggerTracker();
    const base = makeAgent('ana', 0, 'working');
    tracker.update(snap([base]));
    expect(tracker.update(snap([withRecent(base, [bash('git commit -m "x"'), failure()])]))).toEqual([]);
    const good = withRecent(base, [bash('git commit -m "y"'), edit()]);
    expect(tracker.update(snap([good])).map((t) => t.kind)).toEqual(['commit']);
  });

  it('treats a commit still pending when the turn ends as a success', () => {
    const tracker = new TriggerTracker();
    const base = makeAgent('ana', 0, 'working');
    tracker.update(snap([base]));
    tracker.update(snap([withRecent(base, [bash('git commit -m "z"')])]));
    const idle = { ...withRecent(base, [bash('git commit -m "z"')]), status: 'idle' as const, statusSince: 5000 };
    expect(tracker.update(snap([idle])).map((t) => t.kind)).toContain('commit');
  });

  it('celebrates when the task list becomes fully completed', () => {
    const tracker = new TriggerTracker();
    const task = (status: 'pending' | 'completed', id: string) => ({ id, title: id, status });
    const base = makeAgent('ana', 0, 'working', { tasks: [task('completed', '1'), task('pending', '2')] });
    tracker.update(snap([base]));
    const done = { ...base, tasks: [task('completed', '1'), task('completed', '2')] };
    expect(tracker.update(snap([done])).map((t) => t.kind)).toEqual(['tasks-done']);
    expect(tracker.update(snap([done]))).toEqual([]);
  });

  it('celebrates a subagent that finishes well and not one whose last activity failed', () => {
    const tracker = new TriggerTracker();
    const sub = makeAgent('sub1', 0, 'working', { kind: 'sub', parentId: 'ana' });
    const sub2 = makeAgent('sub2', 0, 'working', { kind: 'sub', parentId: 'ana' });
    tracker.update(snap([sub, sub2]));
    const ok = { ...sub, status: 'done' as const };
    const bad = withRecent({ ...sub2, status: 'done' as const }, [failure()]);
    expect(tracker.update(snap([ok, bad]))).toEqual([
      { kind: 'subagent-done', agentId: 'sub1', projectId: '/work/proj-0' },
    ]);
  });

  it('celebrates the end of a long work streak only', () => {
    const tracker = new TriggerTracker();
    const working = makeAgent('ana', 0, 'working', { statusSince: 1000 });
    tracker.update(snap([working]));
    const long = { ...working, status: 'idle' as const, statusSince: 1000 + STREAK_MS + 1 };
    expect(tracker.update(snap([long])).map((t) => t.kind)).toEqual(['streak-end']);

    const quick = new TriggerTracker();
    quick.update(snap([working]));
    expect(quick.update(snap([{ ...working, status: 'idle' as const, statusSince: 20_000 }]))).toEqual([]);
  });

  it('uses a short streak in demo mode', () => {
    const tracker = new TriggerTracker();
    const demo = (a: Agent) => snap([a], { meta: { version: 't', startedAt: 0, local: true, demo: true } });
    const working = makeAgent('ana', 0, 'working', { statusSince: 1000 });
    tracker.update(demo(working));
    expect(tracker.update(demo({ ...working, status: 'idle', statusSince: 40_000 })).map((t) => t.kind)).toEqual([
      'streak-end',
    ]);
  });

  it('celebrates a new commit of the repository and a merged pull request', () => {
    const tracker = new TriggerTracker();
    const agent = makeAgent('ana', 0, 'working');
    const git = (hash: string, state: 'open' | 'merged') => ({
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      insertions: 0,
      deletions: 0,
      stash: 0,
      lastCommit: { hash, subject: 's', at: 1 },
      pr: {
        number: 1,
        title: 't',
        state,
        url: 'https://x',
        draft: false,
        ci: 'none' as const,
        checks: { total: 0, passed: 0, failed: 0, pending: 0 },
      },
    });
    const withGit = (hash: string, state: 'open' | 'merged'): OfficeSnapshot => {
      const s = snap([agent]);
      return { ...s, projects: s.projects.map((p) => ({ ...p, git: git(hash, state) })) };
    };
    tracker.update(withGit('aaa', 'open'));
    expect(tracker.update(withGit('bbb', 'open')).map((t) => t.kind)).toEqual(['commit']);
    expect(tracker.update(withGit('bbb', 'merged')).map((t) => t.kind)).toEqual(['pr-merged']);
  });

  it('primes again after a reset', () => {
    const tracker = new TriggerTracker();
    const base = makeAgent('ana', 0, 'working', { tasks: [{ id: '1', title: 'a', status: 'pending' }] });
    tracker.update(snap([base]));
    tracker.reset();
    const done = { ...base, tasks: [{ id: '1', title: 'a', status: 'completed' as const }] };
    expect(tracker.update(snap([done]))).toEqual([]);
  });
});

describe('room milestone', () => {
  const task = (status: 'pending' | 'completed', id: string) => ({ id, title: id, status });
  it('needs every task of the room done and a minimum count', () => {
    const a = makeAgent('ana', 0, 'idle', { tasks: [task('completed', '1'), task('completed', '2')] });
    const b = makeAgent('bia', 0, 'idle', { tasks: [task('completed', '3')] });
    expect(roomMilestone([a, b], '/work/proj-0')).toBe(true);
    expect(roomMilestone([a], '/work/proj-0')).toBe(false);
    const c = makeAgent('caio', 0, 'working', { tasks: [task('pending', '4')] });
    expect(roomMilestone([a, b, c], '/work/proj-0')).toBe(false);
  });
});
