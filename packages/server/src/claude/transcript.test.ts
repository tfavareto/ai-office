import { appendFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type FakeClaudeDir, assistantLine, jsonl, makeFakeClaude, text, thinking, toolResultLine, toolUse, userLine } from '../test-helpers';
import { TranscriptCache, TranscriptView } from './transcript';
import { scanRecentSessions } from './sessions-scan';

let fake: FakeClaudeDir;
beforeEach(async () => {
  fake = await makeFakeClaude();
});
afterEach(async () => {
  await fake.cleanup();
});

describe('TranscriptView', () => {
  test('renders prompts, assistant text, thinking and tool calls with their results', async () => {
    const path = await fake.writeTranscript(
      's1',
      jsonl(
        userLine('Leia o arquivo', 0),
        assistantLine([thinking('vou ler'), text('Certo.'), toolUse('t1', 'Read', { file_path: '/p/a.ts' })], 10),
        toolResultLine('t1', 'conteúdo do arquivo', 20),
        assistantLine([toolUse('t2', 'Bash', { command: 'npm test' })], 30),
        toolResultLine('t2', 'FAIL', 40, {}, true),
      ),
    );
    const view = new TranscriptView(path);
    expect(await view.update()).toBe(true);
    const { entries, next } = view.page(undefined);
    expect(entries.map((e) => e.kind)).toEqual(['user', 'thinking', 'assistant', 'tool', 'tool']);
    expect(entries[3]).toMatchObject({ kind: 'tool', id: 't1', name: 'Read', summary: '📖 Lendo a.ts', result: 'conteúdo do arquivo' });
    expect(entries[4]).toMatchObject({ result: 'FAIL', error: true });
    expect(next).toBe(5);
  });

  test('skips empty thinking, ignores irrelevant lines and renders compaction notes and interruptions', async () => {
    const path = await fake.writeTranscript(
      's1',
      jsonl(
        userLine('oi', 0),
        assistantLine([thinking('')], 1),
        '{"type":"file-history-snapshot"}',
        JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: new Date(1_800_000_000_000).toISOString() }),
        userLine('[Request interrupted by user]', 5),
      ),
    );
    const view = new TranscriptView(path);
    await view.update();
    expect(view.page(undefined).entries.map((e) => (e.kind === 'system' ? e.text : e.kind))).toEqual(['user', 'Conversa compactada', 'Interrompido pelo usuário']);
  });

  test('pagination: `after` returns newer entries; `next` stays at tools still waiting for a result', async () => {
    const path = await fake.writeTranscript('s1', jsonl(userLine('go', 0), assistantLine([toolUse('t1', 'Bash', { command: 'sleep 5' })], 10)));
    const view = new TranscriptView(path);
    await view.update();
    const first = view.page(undefined);
    expect(first.entries).toHaveLength(2);
    expect(first.next).toBe(1); // the pending tool entry
    await appendFile(path, jsonl(toolResultLine('t1', 'feito', 20), assistantLine([text('Terminei')], 30)));
    await view.update();
    const second = view.page(first.next);
    expect(second.entries.map((e) => e.kind)).toEqual(['tool', 'assistant']);
    expect(second.entries[0]).toMatchObject({ id: 't1', result: 'feito' });
    expect(second.next).toBe(3);
    expect(view.page(second.next).entries).toEqual([]);
  });

  test('missing files are reported and partial lines wait for the newline', async () => {
    expect(await new TranscriptView('/nao/existe.jsonl').update()).toBe(false);
    const path = await fake.writeTranscript('s2', userLine('um', 0) + '\n' + '{"type":"user","timest');
    const view = new TranscriptView(path);
    await view.update();
    expect(view.page(undefined).entries).toHaveLength(1);
  });

  test('TranscriptCache reuses views and evicts the oldest', async () => {
    const a = await fake.writeTranscript('a', jsonl(userLine('a', 0)));
    const b = await fake.writeTranscript('b', jsonl(userLine('b', 0)));
    const cache = new TranscriptCache(1);
    const first = await cache.open(a);
    expect(await cache.open(a)).toBe(first);
    expect(await cache.open(b)).not.toBe(first);
    expect(await cache.open(a)).not.toBe(first);
    expect(await cache.open('/nao/existe.jsonl')).toBeUndefined();
  });
});

describe('scanRecentSessions', () => {
  test('lists recent sessions with title, project, open flag and newest first', async () => {
    await fake.writeTranscript('old', jsonl(userLine('Primeira tarefa antiga', -5000, { cwd: '/work/old' }), '{"type":"custom-title","customTitle":"Título antigo"}'), '/work/old');
    await fake.writeTranscript('new', jsonl(userLine('Tarefa nova', 0), assistantLine([text('ok')], 10)), '/work/proj');
    const { utimes } = await import('node:fs/promises');
    await utimes(fake.transcriptPath('old', '/work/old'), new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
    const account = { id: 'claude', label: 'Pessoal', initial: 'P', color: '#fff', dir: fake.dir };
    const sessions = await scanRecentSessions([account], Date.now(), (_, sessionId) => (sessionId === 'new' ? { agentId: 'claude:new', title: 'Nome do registro' } : undefined));
    expect(sessions.map((s) => s.sessionId)).toEqual(['new', 'old']);
    expect(sessions[0]).toMatchObject({ projectPath: '/work/proj', projectName: 'proj', title: 'Nome do registro', open: true, agentId: 'claude:new' });
    expect(sessions[1]).toMatchObject({ projectName: 'old', title: 'Título antigo', open: false });
    expect(sessions[1]?.firstAt).toBeGreaterThan(0);
  });

  test('ignores sessions older than 7 days and empty files', async () => {
    const { utimes } = await import('node:fs/promises');
    const stale = await fake.writeTranscript('stale', jsonl(userLine('antiga', 0)), '/work/stale');
    const long = new Date(Date.now() - 8 * 24 * 3_600_000);
    await utimes(stale, long, long);
    await fake.writeTranscript('empty', '', '/work/empty');
    const account = { id: 'claude', label: 'Pessoal', initial: 'P', color: '#fff', dir: fake.dir };
    expect(await scanRecentSessions([account], Date.now(), () => undefined)).toEqual([]);
  });
});
