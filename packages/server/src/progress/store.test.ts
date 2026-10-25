import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PROGRESS_VERSION, dayFacts, emptyState, settle, withDay } from '@ai-office/shared';
import { silentLogger } from '../log';
import { makeTempDir, removeDir } from '../test-helpers';
import { parseProgressFile } from './parse';
import { PROGRESS_FILE, ProgressStore } from './store';

let dir: string;
beforeEach(async () => {
  dir = await makeTempDir('ai-office-progress-');
});
afterEach(() => removeDir(dir));

const NOW = Date.parse('2026-10-21T15:00:00.000Z');

function sample() {
  const state = withDay(
    emptyState(),
    dayFacts('2026-10-20', { tasks: 12, commits: 2, workers: [{ name: 'Ana', project: 'loja', tasks: 12 }] }),
    NOW,
  );
  return settle({ ...state, settledThrough: '2026-10-20' }, NOW).state;
}

describe('ProgressStore', () => {
  test('a new office starts empty', async () => {
    const store = new ProgressStore(dir, silentLogger, () => NOW);

    expect(await store.load()).toEqual(emptyState());
  });

  test('keeps the progress across restarts', async () => {
    const saved = sample();
    await new ProgressStore(dir, silentLogger, () => NOW).save(saved);

    const loaded = await new ProgressStore(dir, silentLogger, () => NOW).load();

    expect(loaded).toEqual(saved);
  });

  test('writes a private, versioned file and leaves no temp file behind', async () => {
    await new ProgressStore(dir, silentLogger, () => NOW).save(sample());

    expect(((await stat(join(dir, PROGRESS_FILE))).mode & 0o777).toString(8)).toBe('600');
    expect(JSON.parse(await readFile(join(dir, PROGRESS_FILE), 'utf8'))).toMatchObject({ version: PROGRESS_VERSION });
    expect(await readdir(dir)).toEqual([PROGRESS_FILE]);
  });

  test.each(['not json', '[]', '{"version":0}', '{"nothing":true}'])(
    'moves an unreadable file (%s) aside and starts empty',
    async (content) => {
      await writeFile(join(dir, PROGRESS_FILE), content);

      const loaded = await new ProgressStore(dir, silentLogger, () => NOW).load();

      expect(loaded).toEqual(emptyState());
      expect((await readdir(dir)).some((name) => name.startsWith(`${PROGRESS_FILE}.unreadable-`))).toBe(true);
    },
  );

  test('keeps a file from a newer version aside instead of overwriting it', async () => {
    await writeFile(join(dir, PROGRESS_FILE), JSON.stringify({ version: PROGRESS_VERSION + 1, days: {} }));

    await new ProgressStore(dir, silentLogger, () => NOW).load();

    expect((await readdir(dir)).some((name) => name.includes('unreadable'))).toBe(true);
  });

  test('resolves false when the disk refuses', async () => {
    const blocked = join(dir, 'blocked');
    await writeFile(blocked, 'x');

    expect(await new ProgressStore(join(blocked, 'state'), silentLogger, () => NOW).save(sample())).toBe(false);
  });
});

describe('parseProgressFile', () => {
  test('drops what cannot be trusted and keeps the rest', () => {
    const good = JSON.parse(JSON.stringify(sample())) as Record<string, unknown>;
    const days = good.days as Record<string, unknown>;
    days['not-a-date'] = days['2026-10-20'];
    days['2026-10-19'] = { tasks: -5 };
    (good.unlocks as Record<string, unknown>).madeUp = 5;

    const parsed = parseProgressFile(good);

    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(Object.keys(parsed.state.days)).toEqual(['2026-10-20']);
    expect(parsed.state.unlocks).not.toHaveProperty('madeUp');
    expect(parsed.dropped).toBe(3);
  });

  test('clamps names and ignores nonsense numbers', () => {
    const raw = {
      version: PROGRESS_VERSION,
      days: {
        '2026-10-20': {
          ...dayFacts('2026-10-20'),
          workers: [
            { name: 'x'.repeat(500), tasks: 2 },
            { name: 'Ana', tasks: 'many' },
          ],
        },
      },
      records: { xp: Number.POSITIVE_INFINITY, bestStreak: 3 },
    };

    const parsed = parseProgressFile(raw);

    expect(parsed.status === 'ok' && parsed.state.days['2026-10-20'].workers).toEqual([]);
    expect(parsed.status === 'ok' && parsed.state.records).toEqual({
      peakAgents: 0,
      peakSubagents: 0,
      bestStreak: 3,
      xp: 0,
    });
  });
});
