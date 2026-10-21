import { mkdir, readFile, readdir, stat, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Account, UsageRow } from '@ai-office/shared';
import { accountsFromDirs } from '../claude/accounts';
import { silentLogger } from '../log';
import { type FakeClaudeDir, T0, assistantLine, jsonl, makeFakeClaude, makeTempDir, removeDir, text, userLine } from '../test-helpers';
import { INDEX_DIR_NAME } from './index-file';
import { UsageIndexer } from './indexer';

let fake: FakeClaudeDir;
let state: string;
let accounts: Account[];
let clock: number;
let indexer: UsageIndexer;

beforeEach(async () => {
  fake = await makeFakeClaude();
  state = await makeTempDir('ai-office-index-');
  accounts = accountsFromDirs([fake.dir], fake.home);
  clock = T0 + 60_000;
});
afterEach(async () => {
  await indexer?.stop();
  await removeDir(fake.home);
  await removeDir(state);
});

function create(): UsageIndexer {
  indexer = new UsageIndexer({ stateDir: state, accounts: () => accounts, log: silentLogger, now: () => clock });
  return indexer;
}

/** Starts an indexer and waits for its first pass. */
async function boot(): Promise<UsageIndexer> {
  const created = create();
  await created.start();
  await created.refresh({ walk: true });
  return created;
}

async function restart(): Promise<UsageIndexer> {
  await indexer.stop();
  return boot();
}

const usageOf = (input: number, output: number, write = 0, read = 0): Record<string, unknown> => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: write, cache_read_input_tokens: read });
const rows = (target: UsageIndexer): UsageRow[] => [...target.rows()];
const sum = (list: readonly UsageRow[], key: 'input' | 'output' | 'cacheWrite' | 'cacheRead'): number => list.reduce((total, row) => total + row[key], 0);

describe('indexing a transcript', () => {
  test('aggregates by hour, project, model and session, with the estimated cost', async () => {
    // Arrange
    await fake.writeTranscript('s1', jsonl(userLine('hi', 0), assistantLine([text('a')], 1000, { id: 'm1', usage: usageOf(100, 50, 200, 3000) })));
    // Act
    const target = await boot();
    // Assert
    expect(rows(target)).toEqual([
      {
        hour: Math.floor((T0 + 1000) / 3_600_000) * 3_600_000,
        account: 'claude',
        project: '/work/proj',
        model: 'claude-sonnet-5-5',
        session: 's1',
        agent: '',
        input: 100,
        output: 50,
        cacheWrite: 200,
        cacheRead: 3000,
        costUSD: (100 * 3 + 50 * 15 + 200 * 3.75 + 3000 * 0.3) / 1e6,
      },
    ]);
  });

  test('counts a message split across several lines once, keeping the final numbers', async () => {
    // Arrange: Claude Code writes one line per content block of the same message, with growing output.
    await fake.writeTranscript(
      's1',
      jsonl(
        assistantLine([text('a')], 1000, { id: 'm1', usage: usageOf(100, 5, 200, 3000) }),
        assistantLine([text('b')], 1100, { id: 'm1', usage: usageOf(100, 40, 200, 3000) }),
        assistantLine([text('c')], 1200, { id: 'm1', usage: usageOf(100, 90, 200, 3000) }),
        assistantLine([text('d')], 2000, { id: 'm2', usage: usageOf(10, 10, 0, 100) }),
      ),
    );
    // Act
    const target = await boot();
    // Assert
    const list = rows(target);
    expect(sum(list, 'input')).toBe(110);
    expect(sum(list, 'output')).toBe(100);
    expect(sum(list, 'cacheRead')).toBe(3100);
  });

  test('a message continued after the first read is still counted once', async () => {
    // Arrange
    await fake.writeTranscript('s1', jsonl(assistantLine([text('a')], 1000, { id: 'm1', usage: usageOf(100, 5, 0, 10) })));
    const target = await boot();
    // Act: the rest of the same message arrives later, with the final output count.
    await fake.appendTranscript('s1', jsonl(assistantLine([text('b')], 1200, { id: 'm1', usage: usageOf(100, 60, 0, 10) })));
    await target.refresh({ walk: true });
    // Assert
    expect(sum(rows(target), 'output')).toBe(60);
    expect(sum(rows(target), 'input')).toBe(100);
  });

  test('includes subagent transcripts under their session, ignoring other lines', async () => {
    // Arrange
    await fake.writeTranscript('s1', jsonl(assistantLine([text('a')], 1000, { id: 'm1', usage: usageOf(1, 1) })));
    await fake.writeSubagent('s1', 'ag7', jsonl(assistantLine([text('b')], 1500, { id: 'sub1', model: 'claude-haiku-4-5', usage: usageOf(2, 3), extra: { agentId: 'ag7' } }), userLine('noise', 1600)));
    // Act
    const target = await boot();
    // Assert
    const sub = rows(target).find((row) => row.agent === 'ag7');
    expect(sub).toMatchObject({ session: 's1', model: 'claude-haiku-4-5', output: 3 });
    expect(rows(target)).toHaveLength(2);
  });

  test('skips synthetic messages, lines before the previous month and bad lines', async () => {
    // Arrange
    const old = assistantLine([text('o')], -90 * 24 * 3_600_000, { id: 'old', usage: usageOf(999, 999) });
    await fake.writeTranscript('s1', jsonl(old, assistantLine([text('s')], 1000, { id: 'syn', model: '<synthetic>', usage: usageOf(5, 5) }), '{ broken "usage" "type":"assistant"', assistantLine([text('k')], 2000, { id: 'ok', usage: usageOf(4, 4) })));
    // Act
    const target = await boot();
    // Assert
    expect(sum(rows(target), 'input')).toBe(4);
  });

  test('keeps accounts apart', async () => {
    // Arrange
    accounts = accountsFromDirs([fake.dir, join(fake.home, '.claude-work')], fake.home);
    await mkdir(join(fake.home, '.claude-work', 'projects', '-work-proj'), { recursive: true });
    await writeFile(join(fake.home, '.claude-work', 'projects', '-work-proj', 'w1.jsonl'), jsonl(assistantLine([text('w')], 1000, { id: 'w', usage: usageOf(8, 8) })));
    await fake.writeTranscript('s1', jsonl(assistantLine([text('a')], 1000, { id: 'a', usage: usageOf(1, 1) })));
    // Act
    const target = await boot();
    // Assert
    expect(rows(target).map((row) => [row.account, row.input]).sort()).toEqual([
      ['claude', 1],
      ['claude-work', 8],
    ]);
  });
});

describe('incremental reading and persistence', () => {
  test('reads only what was appended, and only complete lines', async () => {
    // Arrange
    const first = assistantLine([text('a')], 1000, { id: 'm1', usage: usageOf(10, 1) });
    await fake.writeTranscript('s1', jsonl(first));
    const target = await boot();
    const second = assistantLine([text('b')], 2000, { id: 'm2', usage: usageOf(20, 2) });
    // Act: the writer is in the middle of the second line.
    await fake.appendTranscript('s1', second.slice(0, 40));
    await target.refresh({ walk: true });
    const midLine = sum(rows(target), 'input');
    await fake.appendTranscript('s1', `${second.slice(40)}\n`);
    await target.refresh({ walk: true });
    // Assert
    expect(midLine).toBe(10);
    expect(sum(rows(target), 'input')).toBe(30);
  });

  test('a restart resumes from the saved offsets without counting anything twice', async () => {
    // Arrange
    await fake.writeTranscript('s1', jsonl(assistantLine([text('a')], 1000, { id: 'm1', usage: usageOf(10, 1) })));
    await boot();
    await fake.appendTranscript('s1', jsonl(assistantLine([text('b')], 2000, { id: 'm2', usage: usageOf(20, 2) })));
    // Act
    const again = await restart();
    // Assert
    expect(sum(rows(again), 'input')).toBe(30);
    expect(sum(rows(again), 'output')).toBe(3);
  });

  test('a message continued across a restart is still counted once', async () => {
    // Arrange
    await fake.writeTranscript('s1', jsonl(assistantLine([text('a')], 1000, { id: 'm1', usage: usageOf(100, 5) })));
    await boot();
    await fake.appendTranscript('s1', jsonl(assistantLine([text('b')], 1100, { id: 'm1', usage: usageOf(100, 70) })));
    // Act
    const again = await restart();
    // Assert
    expect(sum(rows(again), 'input')).toBe(100);
    expect(sum(rows(again), 'output')).toBe(70);
  });

  test('stores only numbers, with private permissions', async () => {
    // Arrange
    await fake.writeTranscript('s1', jsonl(userLine('SECRET-PROMPT', 0), assistantLine([text('SECRET-REPLY')], 1000, { id: 'm1', usage: usageOf(1, 1) })));
    // Act
    await boot();
    await indexer.stop();
    // Assert
    const dir = join(state, INDEX_DIR_NAME);
    const names = await readdir(dir);
    expect(names).toContain('meta.json');
    expect(names.some((name) => /^\d{4}-\d{2}\.json$/.test(name))).toBe(true);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    for (const name of names) {
      expect((await stat(join(dir, name))).mode & 0o777).toBe(0o600);
      const content = await readFile(join(dir, name), 'utf8');
      expect(content).not.toContain('SECRET');
    }
  });

  test('picks up new transcripts and growth on later passes', async () => {
    // Arrange
    const target = await boot();
    expect(rows(target)).toHaveLength(0);
    // Act
    await fake.writeTranscript('late', jsonl(assistantLine([text('a')], 5000, { id: 'l1', usage: usageOf(3, 3) })));
    await target.refresh({ walk: true });
    // Assert
    expect(sum(rows(target), 'input')).toBe(3);
  });
});

describe('recovery', () => {
  const seed = async (): Promise<void> => {
    await fake.writeTranscript('s1', jsonl(assistantLine([text('a')], 1000, { id: 'm1', usage: usageOf(10, 1) }), assistantLine([text('b')], 4_000_000, { id: 'm2', usage: usageOf(20, 2) })));
    await boot();
    await indexer.stop();
  };

  test('a damaged meta file is ignored and the index is rebuilt from the transcripts', async () => {
    await seed();
    await writeFile(join(state, INDEX_DIR_NAME, 'meta.json'), '{"v":1,"gen":');
    const again = await boot();
    expect(sum(rows(again), 'input')).toBe(30);
  });

  test('a damaged shard is ignored and the index is rebuilt', async () => {
    await seed();
    const shard = (await readdir(join(state, INDEX_DIR_NAME))).find((name) => /^\d{4}-\d{2}\.json$/.test(name)) as string;
    await writeFile(join(state, INDEX_DIR_NAME, shard), 'garbage');
    const again = await boot();
    expect(sum(rows(again), 'input')).toBe(30);
  });

  test('a shard newer than the meta file (an interrupted save) triggers a rebuild, not double counting', async () => {
    await seed();
    const dir = join(state, INDEX_DIR_NAME);
    const shardName = (await readdir(dir)).find((name) => /^\d{4}-\d{2}\.json$/.test(name)) as string;
    const shard = JSON.parse(await readFile(join(dir, shardName), 'utf8')) as { gen: number };
    await writeFile(join(dir, shardName), JSON.stringify({ ...shard, gen: shard.gen + 5 }));
    const again = await boot();
    expect(sum(rows(again), 'input')).toBe(30);
  });

  test('an unknown index version is ignored', async () => {
    await seed();
    const metaPath = join(state, INDEX_DIR_NAME, 'meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Record<string, unknown>;
    await writeFile(metaPath, JSON.stringify({ ...meta, v: 99 }));
    const again = await boot();
    expect(sum(rows(again), 'input')).toBe(30);
  });

  test('a transcript that was truncated or replaced rebuilds the index', async () => {
    // Arrange
    await fake.writeTranscript('s1', jsonl(assistantLine([text('a')], 1000, { id: 'm1', usage: usageOf(10, 1) }), assistantLine([text('b')], 2000, { id: 'm2', usage: usageOf(20, 2) })));
    const target = await boot();
    expect(sum(rows(target), 'input')).toBe(30);
    // Act
    await truncate(fake.transcriptPath('s1'), 0);
    await fake.appendTranscript('s1', jsonl(assistantLine([text('c')], 3000, { id: 'm3', usage: usageOf(7, 1) })));
    await target.refresh({ walk: true });
    // Assert
    expect(sum(rows(target), 'input')).toBe(7);
  });
});

describe('progress and figures', () => {
  test('reports indexing until the first pass is done, then ready', async () => {
    // Arrange
    await fake.writeTranscript('s1', jsonl(assistantLine([text('a')], 1000, { id: 'm1', usage: usageOf(1, 1) })));
    const target = create();
    // Assert before and after
    expect(target.progress()).toMatchObject({ state: 'indexing', percent: 0 });
    await target.start();
    await target.refresh({ walk: true });
    expect(target.progress()).toMatchObject({ state: 'ready', percent: 100 });
  });

  test('computes the card figures and the burn rate from what was read', async () => {
    // Arrange: two messages in the last half hour.
    clock = T0 + 3_600_000;
    await fake.writeTranscript(
      's1',
      jsonl(
        assistantLine([text('a')], 3_600_000 - 20 * 60_000, { id: 'm1', usage: usageOf(1000, 1000, 0, 0) }),
        assistantLine([text('b')], 3_600_000 - 5 * 60_000, { id: 'm2', usage: usageOf(2000, 1000, 0, 0) }),
      ),
    );
    // Act
    const target = await boot();
    const [usage] = target.compute(['claude'], clock);
    // Assert
    expect(usage?.window5h.tokens).toBe(5000);
    expect(usage?.today.tokens).toBeGreaterThan(0);
    expect(usage?.burn).toMatchObject({ tokens30m: 5000, tokens60m: 5000 });
    expect(usage?.peaks?.window5h.samples).toBe(0);
  });

  test('accounts without a projects folder do not break the pass', async () => {
    accounts = accountsFromDirs([join(fake.home, '.claude-missing')], fake.home);
    const target = await boot();
    expect(rows(target)).toHaveLength(0);
    expect(target.progress().state).toBe('ready');
  });
});
