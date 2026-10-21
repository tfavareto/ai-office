import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { silentLogger } from '../log';
import { makeTempDir, removeDir } from '../test-helpers';
import { RULES_FILE, RULES_LOG_FILE, RulesStore } from './rules-store';

let dir: string;
const NOW = Date.parse('2026-10-19T15:00:00Z');

beforeEach(async () => {
  dir = join(await makeTempDir('ai-office-rules-'), 'state');
});
afterEach(() => removeDir(join(dir, '..')));

const open = (): RulesStore => new RulesStore(dir, silentLogger, () => NOW);
const draft = { effect: 'allow', tool: 'Bash', matcher: { kind: 'command-prefix', value: 'npm test' } };
const asker = {
  toolName: 'Bash',
  input: { command: 'npm test' },
  summary: 'npm test',
  agentId: 'a1',
  agentName: 'Ana',
  projectPath: '/demo/loja',
};

async function mode(name: string): Promise<number> {
  return (await stat(join(dir, name))).mode & 0o777;
}

describe('RulesStore: saving', () => {
  test('writes rules and log atomically with mode 0600 and a schema version', async () => {
    const store = open();
    await store.load();
    store.book.create(draft);
    store.book.decide(asker);
    expect(await store.flush()).toBe(true);
    const saved = JSON.parse(await readFile(join(dir, RULES_FILE), 'utf8')) as {
      version: number;
      rules: { hits: number }[];
    };
    expect(saved).toMatchObject({ version: 1, rules: [{ hits: 1 }] });
    expect(JSON.parse(await readFile(join(dir, RULES_LOG_FILE), 'utf8'))).toMatchObject({
      version: 1,
      entries: [{ outcome: 'allow', subject: 'npm test' }],
    });
    expect(await mode(RULES_FILE)).toBe(0o600);
    expect(await mode(RULES_LOG_FILE)).toBe(0o600);
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  test('a new store reads back rules, counters and log', async () => {
    const first = open();
    await first.load();
    first.book.create(draft);
    first.book.decide(asker);
    await first.flush();
    const second = open();
    await second.load();
    expect(second.book.rules()).toMatchObject([{ matcher: { value: 'npm test' }, hits: 1, enabled: true }]);
    expect(second.book.log()).toHaveLength(1);
  });

  test('only writes what changed', async () => {
    const store = open();
    await store.load();
    store.book.create(draft);
    await store.flush();
    const { mtimeMs } = await stat(join(dir, RULES_FILE));
    expect(await readdir(dir)).not.toContain(RULES_LOG_FILE);
    await store.flush();
    expect((await stat(join(dir, RULES_FILE))).mtimeMs).toBe(mtimeMs);
  });

  test('reports a disk that refuses the write, and keeps the change to retry', async () => {
    const store = open();
    await store.load();
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, RULES_FILE));
    store.book.create(draft);
    expect(await store.flush()).toBe(false);
    await removeDir(join(dir, RULES_FILE));
    expect(await store.flush()).toBe(true);
    expect(JSON.parse(await readFile(join(dir, RULES_FILE), 'utf8'))).toMatchObject({ rules: [{ tool: 'Bash' }] });
  });
});

describe('RulesStore: loading', () => {
  test('starts empty when nothing was saved', async () => {
    const store = open();
    await store.load();
    expect(store.book.rules()).toEqual([]);
  });

  test('moves a corrupt file aside instead of overwriting it', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, RULES_FILE), '{not json');
    const store = open();
    await store.load();
    expect(store.book.rules()).toEqual([]);
    expect(await readdir(dir)).toContain(`${RULES_FILE}.unreadable-${NOW}`);
    expect(await readFile(join(dir, `${RULES_FILE}.unreadable-${NOW}`), 'utf8')).toBe('{not json');
    store.book.create(draft);
    await store.flush();
    expect(JSON.parse(await readFile(join(dir, RULES_FILE), 'utf8')).rules).toHaveLength(1);
  });

  test('keeps a file from a newer version aside too', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, RULES_FILE), JSON.stringify({ version: 99, rules: [] }));
    const store = open();
    await store.load();
    expect(await readdir(dir)).toContain(`${RULES_FILE}.unreadable-${NOW}`);
  });

  test('migrates a version-less file and saves it in the current format', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, RULES_FILE),
      JSON.stringify([
        { id: 'old1', effect: 'deny', tool: 'Bash', matcher: { kind: 'command-prefix', value: 'git push' } },
      ]),
    );
    const store = open();
    await store.load();
    expect(store.book.rules()).toMatchObject([{ id: 'old1', hits: 0, enabled: true }]);
    await store.flush();
    expect(JSON.parse(await readFile(join(dir, RULES_FILE), 'utf8'))).toMatchObject({
      version: 1,
      rules: [{ id: 'old1' }],
    });
  });

  test('drops unreadable rules and switches off allow rules the policy refuses', async () => {
    await mkdir(dir, { recursive: true });
    const wide = {
      id: 'wide',
      effect: 'allow',
      tool: 'Bash',
      matcher: { kind: 'any', value: '' },
      scope: {},
      enabled: true,
      createdAt: 1,
      hits: 0,
    };
    await writeFile(join(dir, RULES_FILE), JSON.stringify({ version: 1, rules: [wide, { id: 'bad' }, 'junk'] }));
    const store = open();
    await store.load();
    expect(store.book.rules()).toMatchObject([{ id: 'wide', enabled: false }]);
    expect(store.book.decide({ ...asker, toolName: 'Bash' })).toEqual({ kind: 'none' });
  });

  test('ignores a damaged log without losing the rules', async () => {
    const first = open();
    await first.load();
    first.book.create(draft);
    await first.flush();
    await writeFile(join(dir, RULES_LOG_FILE), 'oops');
    const second = open();
    await second.load();
    expect(second.book.rules()).toHaveLength(1);
    expect(second.book.log()).toEqual([]);
    expect(await readdir(dir)).toContain(`${RULES_LOG_FILE}.unreadable-${NOW}`);
  });

  test('survives a file it cannot read at all', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, RULES_FILE), '[]');
    await chmod(join(dir, RULES_FILE), 0o000);
    const store = open();
    await expect(store.load()).resolves.toBeUndefined();
    await chmod(join(dir, RULES_FILE), 0o600).catch(() => undefined);
  });
});
