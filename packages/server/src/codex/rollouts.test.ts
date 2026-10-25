import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { T0 } from '../test-helpers';
import { type FakeCodexHome, THREAD, makeFakeCodex, record, rolloutName, sessionMeta, userMessage } from './fixtures';
import { classifyMeta, findRollout, listRollouts, readFirstRecord, readRolloutHead } from './rollouts';

let fake: FakeCodexHome;
beforeEach(async () => {
  fake = await makeFakeCodex();
});
afterEach(() => fake.cleanup());

describe('classifyMeta', () => {
  test('a plain session is main', () => {
    expect(
      classifyMeta({ id: THREAD, cwd: '/w', source: 'cli', timestamp: '2026-10-19T12:00:00.000Z' }, 'f'),
    ).toMatchObject({
      kind: 'main',
      threadId: THREAD,
      cwd: '/w',
      parentId: undefined,
      startedAt: T0,
    });
  });

  test('a spawned thread is a subagent of its parent', () => {
    const head = classifyMeta(
      {
        id: 'child',
        source: {
          subagent: {
            thread_spawn: { parent_thread_id: 'parent', depth: 1, agent_nickname: 'Ada', agent_role: 'explorer' },
          },
        },
      },
      'f',
    );
    expect(head).toMatchObject({ kind: 'sub', parentId: 'parent', nickname: 'Ada', role: 'explorer' });
  });

  test.each([
    [{ subagent: { other: 'guardian_review' } }],
    [{ subagent: 'review' }],
    [{ subagent: 'compact' }],
    [{ subagent: 'memory_consolidation' }],
  ])('housekeeping threads (%j) are internal', (source) => {
    expect(classifyMeta({ id: 'x', source, parent_thread_id: 'p' }, 'f')).toMatchObject({
      kind: 'internal',
      parentId: 'p',
    });
  });

  test('a fork with a parent id but no subagent source is still a session', () => {
    expect(classifyMeta({ id: 'x', source: 'cli', parent_thread_id: 'p' }, 'f')).toMatchObject({
      kind: 'main',
      parentId: undefined,
    });
  });

  test('the file name stands in for a missing id', () => {
    expect(classifyMeta({}, 'from-name').threadId).toBe('from-name');
  });
});

describe('listRollouts', () => {
  test('lists rollouts of recent days by name pattern and age', async () => {
    const recent = await fake.write(THREAD, sessionMeta(0));
    const old = await fake.write('0199aaaa-bbbb-7ccc-8ddd-000000000002', sessionMeta(0), '2026/09/01');
    const oldTime = new Date(T0 - 40 * 86_400_000);
    await utimes(old, oldTime, oldTime);
    await writeFile(join(fake.dir, 'sessions', '2026', '10', '19', 'notes.txt'), 'x');
    await mkdir(join(fake.dir, 'sessions', 'tmp'));
    const found = await listRollouts(fake.dir, T0 - 3600_000);
    expect(found.map((file) => file.path)).toEqual([recent]);
    expect(found[0]).toMatchObject({ threadId: THREAD, rel: expect.stringContaining('sessions/2026/10/19/rollout-') });
  });

  test('files older than the cut are left out even in a recent folder', async () => {
    const path = await fake.write(THREAD, sessionMeta(0));
    const stale = new Date(T0 - 2 * 3600_000);
    await utimes(path, stale, stale);
    expect(await listRollouts(fake.dir, T0 - 3600_000)).toEqual([]);
  });

  test('a home without sessions has no rollouts', async () => {
    expect(await listRollouts(join(fake.dir, 'nowhere'), 0)).toEqual([]);
  });
});

describe('readRolloutHead', () => {
  test('reads the first record', async () => {
    const path = await fake.write(THREAD, `${sessionMeta(0, { cwd: '/proj' })}\n${userMessage('x', 10)}\n`);
    expect(await readRolloutHead({ path, threadId: THREAD })).toMatchObject({
      kind: 'main',
      cwd: '/proj',
      threadId: THREAD,
    });
    expect(await readFirstRecord(path)).toBe(sessionMeta(0, { cwd: '/proj' }));
  });

  test('a long first line is read in full', async () => {
    const path = await fake.write(THREAD, `${sessionMeta(0, { base_instructions: { text: 'z'.repeat(200_000) } })}\n`);
    expect((await readFirstRecord(path))?.length).toBeGreaterThan(200_000);
  });

  test('a missing, empty or unreadable file is a plain session for now', async () => {
    expect(await readFirstRecord(join(fake.dir, 'missing'))).toBeUndefined();
    const empty = await fake.write('0199aaaa-bbbb-7ccc-8ddd-000000000003', '');
    expect(await readFirstRecord(empty)).toBeUndefined();
    const garbage = await fake.write('0199aaaa-bbbb-7ccc-8ddd-000000000004', 'not json\n');
    expect(await readRolloutHead({ path: garbage, threadId: 'abc' })).toMatchObject({ kind: 'main', threadId: 'abc' });
  });

  test('a first record that is not a session_meta does not classify the file', async () => {
    const path = await fake.write(
      '0199aaaa-bbbb-7ccc-8ddd-000000000005',
      `${record('event_msg', { type: 'task_started' }, 0)}\n`,
    );
    expect(await readRolloutHead({ path, threadId: 'zzz' })).toMatchObject({ kind: 'main', threadId: 'zzz' });
  });
});

describe('findRollout', () => {
  test('finds a thread by id in any day folder', async () => {
    const path = await fake.write(THREAD, sessionMeta(0), '2026/03/02');
    expect(await findRollout(fake.dir, THREAD)).toBe(path);
    expect(await findRollout(fake.dir, 'nope')).toBeUndefined();
    expect(await findRollout(fake.dir, '../etc')).toBeUndefined();
  });

  test('the file name pattern is the one Codex writes', () => {
    expect(rolloutName(0, THREAD)).toMatch(/^rollout-2026-10-19T12-00-00-0199aaaa/);
  });
});
