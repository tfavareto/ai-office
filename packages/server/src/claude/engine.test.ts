import { rm, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { FeedItem, Notice } from '@ai-office/shared';
import { silentLogger } from '../log';
import { NameStore } from '../office/name-store';
import { Office } from '../office/office';
import { UsageTracker } from '../office/usage';
import { type FakeClaudeDir, T0, assistantLine, jsonl, makeFakeClaude, text, toolResultLine, toolUse, userLine } from '../test-helpers';
import { Engine } from './engine';
import { scanUsageBackwards } from './usage-backfill';

let fake: FakeClaudeDir;
let clock: number;
let feed: FeedItem[];
let notices: Notice[];
let office: Office;
let usage: UsageTracker;
let engine: Engine;

function build(pidAlive: (pid: number) => boolean = () => true): void {
  feed = [];
  notices = [];
  usage = new UsageTracker();
  office = new Office({
    now: () => clock,
    names: new NameStore(undefined, silentLogger),
    log: silentLogger,
    overlays: { permissionFor: () => undefined, attentionFor: () => undefined },
    events: {
      onChange: () => undefined,
      onFeed: (items) => void feed.push(...items),
      onNotice: (notice) => void notices.push(notice),
      onAgentEvent: () => undefined,
      onUsage: (accountId, record) => usage.add(accountId, 'live', record),
    },
  });
  engine = new Engine({ discover: { homeDir: fake.home, explicitDirs: undefined, envDir: undefined }, office, usage, log: silentLogger, now: () => clock, pidAlive });
}

beforeEach(async () => {
  fake = await makeFakeClaude();
  clock = T0 + 60_000;
});
afterEach(async () => {
  engine.stop();
  await fake.cleanup();
});

const agents = () => office.state().agents;

describe('Engine with a registry', () => {
  test('an open session becomes a main agent in a project room', async () => {
    await fake.writeRegistry(100, { sessionId: 's1', name: 'Minha sessão', status: 'busy', statusUpdatedAt: T0 + 59_000 });
    await fake.writeTranscript('s1', jsonl(userLine('Corrigir o bug', 50_000), assistantLine([toolUse('t1', 'Read', { file_path: '/work/proj/src/a.ts' })], 51_000, { stopReason: 'tool_use' })));
    build();
    await engine.scan();
    expect(office.state().projects).toMatchObject([{ id: '/work/proj', name: 'proj', order: 0 }]);
    expect(agents()).toHaveLength(1);
    expect(agents()[0]).toMatchObject({
      id: 'claude:s1',
      kind: 'main',
      role: 'Principal',
      title: 'Minha sessão',
      status: 'working',
      projectId: '/work/proj',
      accountId: 'claude',
      gitBranch: 'main',
      model: 'claude-sonnet-5-5',
      activity: { text: 'Lendo a.ts' },
    });
    expect(agents()[0]?.name).toMatch(/\S/);
    expect(engine.sessionCounts().get('claude')).toBe(1);
  });

  test('history in the transcript tail is replayed silently; new lines hit the feed', async () => {
    await fake.writeRegistry(100, { sessionId: 's1' });
    await fake.writeTranscript('s1', jsonl(userLine('antigo', -600_000), assistantLine([text('feito')], -590_000, { stopReason: 'end_turn' })));
    build();
    await engine.scan();
    expect(feed).toHaveLength(0);
    expect(notices.filter((n) => n.level === 'success')).toHaveLength(0);
    await fake.appendTranscript('s1', jsonl(userLine('nova tarefa', 59_000), assistantLine([toolUse('t', 'Bash', { command: 'npm test', description: 'Rodando testes' })], 59_500)));
    await engine.scan();
    expect(feed.map((item) => item.activity.text)).toEqual(['Nova tarefa: “nova tarefa”', 'Rodando testes']);
    expect(feed[0]).toMatchObject({ agentId: 'claude:s1', projectId: '/work/proj' });
  });

  test('a finished turn raises a success notice with the duration; a tool error raises one warn notice', async () => {
    await fake.writeRegistry(100, { sessionId: 's1' });
    await fake.writeTranscript('s1', jsonl(userLine('go', 58_000)));
    build();
    await engine.scan();
    await fake.appendTranscript(
      's1',
      jsonl(
        assistantLine([toolUse('b', 'Bash', { command: 'x' })], 58_500),
        toolResultLine('b', 'boom', 58_600, {}, true),
        assistantLine([toolUse('b2', 'Bash', { command: 'y' })], 58_700),
        toolResultLine('b2', 'boom2', 58_800, {}, true),
        assistantLine([text('ok')], 59_000, { stopReason: 'end_turn' }),
      ),
    );
    await engine.scan();
    expect(notices.filter((n) => n.level === 'warn')).toHaveLength(1);
    expect(notices.find((n) => n.level === 'success')?.text).toMatch(/concluiu em 1 s/);
    expect(agents()[0]?.status).toBe('idle');
  });

  test('AskUserQuestion makes the agent wait with "Responder uma pergunta"', async () => {
    await fake.writeRegistry(100, { sessionId: 's1', status: 'busy', statusUpdatedAt: T0 + 59_000 });
    await fake.writeTranscript('s1', jsonl(userLine('go', 58_000), assistantLine([toolUse('q', 'AskUserQuestion', { questions: [] })], 58_500)));
    build();
    await engine.scan();
    expect(agents()[0]).toMatchObject({ status: 'waiting', waitingFor: 'Responder uma pergunta' });
    await engine.scan();
    expect(notices.filter((n) => n.level === 'alert')).toHaveLength(0); // first sight is not a transition
  });

  test('a stuck tool while the registry says idle becomes "Aprovar <ferramenta>", with an alert on the transition', async () => {
    await fake.writeRegistry(100, { sessionId: 's1', status: 'busy', statusUpdatedAt: T0 + 1000 });
    await fake.writeTranscript('s1', jsonl(userLine('go', 58_000), assistantLine([toolUse('b', 'Bash', { command: 'rm -rf x' })], 58_500)));
    build();
    await engine.scan();
    expect(agents()[0]?.status).toBe('working');
    await fake.writeRegistry(100, { sessionId: 's1', status: 'idle', statusUpdatedAt: T0 + 59_000 });
    clock = T0 + 70_000;
    await engine.scan();
    expect(agents()[0]).toMatchObject({ status: 'waiting', waitingFor: 'Aprovar Bash' });
    expect(notices.find((n) => n.level === 'alert')?.text).toContain('precisa de você: Aprovar Bash');
    expect(agents()[0]?.statusSince).toBe(clock);
  });

  test('subagents arrive from their files, are linked by meta, and finish with the spawning tool result', async () => {
    await fake.writeRegistry(100, { sessionId: 's1', status: 'busy', statusUpdatedAt: T0 + 59_000 });
    await fake.writeTranscript('s1', jsonl(userLine('go', 58_000), assistantLine([toolUse('tu1', 'Agent', { description: 'Explorar código', subagent_type: 'Explore' })], 58_500)));
    await fake.writeSubagent('s1', 'ag1', jsonl(userLine('prompt do sub', 58_600, { agentId: 'ag1' }), assistantLine([toolUse('r', 'Grep', { pattern: 'foo' })], 58_700, { extra: { agentId: 'ag1' } })), { agentType: 'Explore', description: 'Explorar código', toolUseId: 'tu1' });
    build();
    await engine.scan();
    const sub = agents().find((a) => a.kind === 'sub');
    expect(sub).toMatchObject({ id: 'claude:s1:ag1', role: 'Explore', title: 'Explorar código', status: 'working', parentId: 'claude:s1', projectId: '/work/proj', activity: { text: 'Buscando “foo”' } });
    expect(agents().find((a) => a.kind === 'main')?.stats.subagents).toBe(1);
    expect(new Set(agents().map((a) => a.name)).size).toBe(2);

    await fake.appendTranscript('s1', jsonl(toolResultLine('tu1', 'achei', 59_500)));
    clock = T0 + 60_000;
    await engine.scan();
    expect(agents().find((a) => a.kind === 'sub')?.status).toBe('done');
    clock = T0 + 60_000 + 7000;
    await engine.scan();
    expect(agents().filter((a) => a.kind === 'sub')).toHaveLength(0);
  });

  test('a subagent file whose meta shows up later is picked up on the next scan', async () => {
    await fake.writeRegistry(100, { sessionId: 's1' });
    await fake.writeTranscript('s1', jsonl(userLine('go', 58_000)));
    await fake.writeSubagent('s1', 'ag2', jsonl(assistantLine([text('oi')], 59_000)));
    build();
    await engine.scan();
    expect(agents().find((a) => a.kind === 'sub')).toMatchObject({ role: 'Subagente' });
    await fake.writeSubagent('s1', 'ag2', jsonl(assistantLine([text('oi')], 59_000)), { agentType: 'Plan', description: 'Planejar' });
    await engine.scan();
    expect(agents().find((a) => a.kind === 'sub')).toMatchObject({ role: 'Plan', title: 'Planejar' });
  });

  test('the session leaves when its registry file disappears or its pid dies', async () => {
    await fake.writeRegistry(100, { sessionId: 's1' });
    await fake.writeRegistry(101, { sessionId: 's2', cwd: '/work/other' });
    await fake.writeTranscript('s1', jsonl(userLine('a', 59_000)));
    await fake.writeTranscript('s2', jsonl(userLine('b', 59_000, { cwd: '/work/other' })), '/work/other');
    let alive = true;
    build((pid) => pid === 100 || alive);
    await engine.scan();
    expect(agents()).toHaveLength(2);
    expect(office.state().projects).toHaveLength(2);
    await rm(join(fake.dir, 'sessions', '100.json'));
    alive = false;
    await engine.scan();
    expect(agents().map((a) => a.status)).toEqual(['offline', 'offline']);
    expect(notices.filter((n) => n.text.includes('saiu do escritório'))).toHaveLength(2);
    clock += 7000;
    await engine.scan();
    expect(agents()).toHaveLength(0);
    expect(office.state().projects).toHaveLength(0);
  });

  test('project orders are assigned by arrival and the lowest free slot is reused', async () => {
    await fake.writeRegistry(100, { sessionId: 's1', cwd: '/work/a' });
    await fake.writeTranscript('s1', jsonl(userLine('a', 59_000, { cwd: '/work/a' })), '/work/a');
    build();
    await engine.scan();
    await fake.writeRegistry(101, { sessionId: 's2', cwd: '/work/b' });
    await fake.writeTranscript('s2', jsonl(userLine('b', 59_000, { cwd: '/work/b' })), '/work/b');
    await engine.scan();
    expect(office.state().projects.map((p) => [p.name, p.order])).toEqual([['a', 0], ['b', 1]]);
    await rm(join(fake.dir, 'sessions', '100.json'));
    clock += 10_000;
    await engine.scan();
    clock += 10_000;
    await engine.scan();
    await fake.writeRegistry(102, { sessionId: 's3', cwd: '/work/c' });
    await fake.writeTranscript('s3', jsonl(userLine('c', 59_000, { cwd: '/work/c' })), '/work/c');
    await engine.scan();
    expect(office.state().projects.map((p) => [p.name, p.order])).toEqual([['c', 0], ['b', 1]]);
  });

  test('bad lines never break the scan; a truncated transcript is re-read from the start', async () => {
    await fake.writeRegistry(100, { sessionId: 's1' });
    const path = await fake.writeTranscript('s1', jsonl(userLine('um', 55_000), 'lixo {{{', '{"type":"user"}', assistantLine([text('dois')], 56_000)));
    build();
    await engine.scan();
    expect(agents()[0]?.activity?.text).toBe('Escrevendo a resposta');
    await truncate(path, 0);
    await writeFile(path, jsonl(userLine('recomeçou', 59_000)));
    await engine.scan();
    expect(agents()[0]?.activity?.text).toBe('Nova tarefa: “recomeçou”');
    expect(agents()[0]?.recent).toHaveLength(1);
  });

  test('a registry entry without a transcript yet shows an idle agent, then picks the file up', async () => {
    await fake.writeRegistry(100, { sessionId: 'novo', status: 'idle' });
    build();
    await engine.scan();
    expect(agents()).toHaveLength(1);
    expect(agents()[0]?.status).toBe('idle');
    await fake.writeTranscript('novo', jsonl(userLine('olá', 59_500)));
    clock += 3000;
    await engine.scan();
    expect(agents()[0]?.activity?.text).toBe('Nova tarefa: “olá”');
  });
});

describe('Engine without a registry', () => {
  test('uses recent transcripts and drops sessions after 30 minutes of silence', async () => {
    const { rm: remove } = await import('node:fs/promises');
    await remove(join(fake.dir, 'sessions'), { recursive: true });
    await fake.writeTranscript('s9', jsonl(userLine('sem registro', 59_000)));
    build();
    clock = Date.now();
    await fake.writeTranscript('s9', jsonl(userLine('sem registro', 0).replace(/"timestamp":"[^"]+"/, `"timestamp":"${new Date(clock - 1000).toISOString()}"`)));
    await engine.scan();
    expect(agents()).toHaveLength(1);
    clock += 31 * 60_000;
    await engine.scan();
    expect(agents()[0]?.status).toBe('offline');
  });
});

describe('usage backfill', () => {
  test('reads usage records backwards and stops at the cutoff', async () => {
    const lines = [
      assistantLine([text('a')], -3_600_000 * 30, { id: 'old', usage: { input_tokens: 1000, output_tokens: 1 } }),
      assistantLine([text('b')], -3_600_000, { id: 'new1', usage: { input_tokens: 10, output_tokens: 2 } }),
      userLine('x', -1000),
      assistantLine([text('c')], 0, { id: 'new2', usage: { input_tokens: 20, output_tokens: 3 } }),
    ];
    const path = await fake.writeTranscript('big', jsonl(...lines));
    const seen: string[] = [];
    await scanUsageBackwards(path, T0 - 3_600_000 * 24, (record) => void seen.push(record.messageId ?? '?'));
    expect(seen).toEqual(['new2', 'new1']);
  });
});
