import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type FakeClaudeDir, T0, makeFakeClaude } from '../test-helpers';
import { accountsFromDirs, discoverAccounts } from './accounts';
import { encodeProjectDir, findTranscript, listSubagents } from './paths';
import { isPidAlive, parseRegistryEntry, readRegistry } from './registry';

let fake: FakeClaudeDir;
beforeEach(async () => {
  fake = await makeFakeClaude();
});
afterEach(async () => {
  await fake.cleanup();
});

describe('readRegistry', () => {
  test('reports an unsupported registry when sessions/ is missing', async () => {
    expect(await readRegistry(join(fake.home, 'nada'))).toEqual({ supported: false, open: [] });
  });

  test('keeps only entries whose pid is alive', async () => {
    await fake.writeRegistry(111, { sessionId: 'alive', name: 'Sessão viva', status: 'busy', statusUpdatedAt: T0 });
    await fake.writeRegistry(222, { sessionId: 'dead' });
    const snapshot = await readRegistry(fake.dir, (pid) => pid === 111);
    expect(snapshot.supported).toBe(true);
    expect(snapshot.open).toHaveLength(1);
    expect(snapshot.open[0]).toMatchObject({
      pid: 111,
      sessionId: 'alive',
      name: 'Sessão viva',
      status: 'busy',
      cwd: '/work/proj',
    });
  });

  test('ignores corrupt files, non-pid names and unsafe session ids', async () => {
    await writeFile(join(fake.dir, 'sessions', '333.json'), '{broken');
    await writeFile(join(fake.dir, 'sessions', '444.abc.key'), '{"peerToken":"x"}');
    await writeFile(join(fake.dir, 'sessions', 'notes.json'), '{}');
    await fake.writeRegistry(555, { sessionId: '../escape' });
    expect((await readRegistry(fake.dir, () => true)).open).toEqual([]);
  });

  test('isPidAlive detects the current process and a missing one', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(2 ** 22 + 12345)).toBe(false);
  });

  test('parseRegistryEntry validates required fields', () => {
    expect(parseRegistryEntry({ pid: 1 })).toBeUndefined();
    expect(parseRegistryEntry({ pid: 1, sessionId: 'abc', startedAt: 5 })).toMatchObject({
      pid: 1,
      sessionId: 'abc',
      startedAt: 5,
      cwd: '',
    });
  });
});

describe('accounts', () => {
  test('discovers ~/.claude* directories that contain projects/, default account first', async () => {
    await mkdir(join(fake.home, '.claude-work', 'projects'), { recursive: true });
    await mkdir(join(fake.home, '.claude-empty'), { recursive: true });
    const accounts = await discoverAccounts({ homeDir: fake.home, explicitDirs: undefined, envDir: undefined });
    expect(accounts.map((a) => [a.id, a.label, a.initial])).toEqual([
      ['claude', 'Pessoal', 'P'],
      ['claude-work', 'work', 'W'],
    ]);
    expect(new Set(accounts.map((a) => a.color)).size).toBe(2);
  });

  test('adds CLAUDE_CONFIG_DIR and honors explicit directories', async () => {
    const extra = join(fake.home, 'custom-config');
    await mkdir(extra, { recursive: true });
    const withEnv = await discoverAccounts({ homeDir: fake.home, explicitDirs: undefined, envDir: extra });
    expect(withEnv.map((a) => a.dir)).toContain(extra);
    const explicit = await discoverAccounts({ homeDir: fake.home, explicitDirs: [extra], envDir: undefined });
    expect(explicit.map((a) => a.dir)).toEqual([extra]);
  });

  test('ignores explicit directories that do not exist', async () => {
    const extra = join(fake.home, 'custom-config');
    await mkdir(extra, { recursive: true });
    const accounts = await discoverAccounts({
      homeDir: fake.home,
      explicitDirs: [extra, join(fake.home, 'missing')],
      envDir: undefined,
    });
    expect(accounts.map((a) => a.dir)).toEqual([extra]);
  });

  test('ids stay unique when folder names collide', () => {
    const accounts = accountsFromDirs(['/a/.claude-x', '/b/.claude-x'], '/home/u');
    expect(new Set(accounts.map((a) => a.id)).size).toBe(2);
  });
});

describe('paths', () => {
  test('encodes cwd like Claude Code does', () => {
    expect(encodeProjectDir('/Users/ana/Projetos/Escritório 3d - X')).toBe('-Users-ana-Projetos-Escrit-rio-3d---X');
  });

  test('finds a transcript directly and by scanning when cwd differs', async () => {
    const path = await fake.writeTranscript('s1', '{}\n');
    expect(await findTranscript(fake.dir, 's1', '/work/proj')).toBe(path);
    expect(await findTranscript(fake.dir, 's1', '/outro/lugar')).toBe(path);
    expect(await findTranscript(fake.dir, 's1')).toBe(path);
    expect(await findTranscript(fake.dir, 'missing', '/work/proj')).toBeUndefined();
    expect(await findTranscript(fake.dir, '../x', '/work/proj')).toBeUndefined();
  });

  test('lists subagent files with their meta (undefined while the meta is missing)', async () => {
    const main = await fake.writeTranscript('s2', '{}\n');
    await fake.writeSubagent('s2', 'aaa', '{}\n', { agentType: 'Explore', description: 'Mapear', toolUseId: 'tu1' });
    await fake.writeSubagent('s2', 'bbb', '{}\n');
    const files = await listSubagents(main);
    expect(files.map((f) => f.agentId).sort()).toEqual(['aaa', 'bbb']);
    expect(files.find((f) => f.agentId === 'aaa')?.meta).toEqual({
      agentType: 'Explore',
      description: 'Mapear',
      toolUseId: 'tu1',
    });
    expect(files.find((f) => f.agentId === 'bbb')?.meta).toBeUndefined();
  });
});
