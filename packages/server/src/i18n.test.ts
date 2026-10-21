// Localizable texts the server emits: every pt-BR text field has a matching message that renders in en and es.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type FeedItem, type Msg, type Notice, sourceText, translateShared } from '@ai-office/shared';
import { accountsFromDirs } from './claude/accounts';
import { Engine } from './claude/engine';
import { TranscriptView } from './claude/transcript';
import { silentLogger } from './log';
import { NameStore } from './office/name-store';
import { Office } from './office/office';
import { deriveStatus, NEEDS_YOU_MSG } from './office/status';
import { MessageRegistry } from './registries/messages';
import { describePermission, describeSuggestion } from './registries/permission-text';
import { type FakeClaudeDir, T0, assistantLine, jsonl, makeFakeClaude, toolUse, userLine } from './test-helpers';

const en = (message: Msg | undefined): string => translateShared('en', message as Msg);
const es = (message: Msg | undefined): string => translateShared('es', message as Msg);
const pt = (message: Msg | undefined): string => sourceText(message as Msg);

describe('permission texts', () => {
  test('summaries of generated prose come with a message; commands and tool names are data', () => {
    expect(describePermission('Bash', { command: 'rm -rf dist' })).toEqual({ summary: 'rm -rf dist' });
    expect(describePermission('mcp__github__create_issue', {})).toEqual({ summary: 'github: create_issue' });
    expect(describePermission('Outra', null)).toEqual({ summary: 'Outra' });
    const edit = describePermission('Edit', { file_path: 'src/app.ts' });
    expect(edit.summary).toBe('Editar src/app.ts');
    expect([pt(edit.summaryMsg), en(edit.summaryMsg), es(edit.summaryMsg)]).toEqual([
      'Editar src/app.ts',
      'Edit src/app.ts',
      'Editar src/app.ts',
    ]);
    const write = describePermission('Write', {});
    expect([write.summary, en(write.summaryMsg), es(write.summaryMsg)]).toEqual([
      'Escrever um arquivo',
      'Write a file',
      'Escribir un archivo',
    ]);
    const fetch = describePermission('WebFetch', { url: 'https://docs.exemplo.com/x' });
    expect([fetch.summary, en(fetch.summaryMsg), es(fetch.summaryMsg)]).toEqual([
      'Acessar docs.exemplo.com',
      'Access docs.exemplo.com',
      'Acceder a docs.exemplo.com',
    ]);
    const search = describePermission('WebSearch', { query: 'vitest' });
    expect([search.summary, en(search.summaryMsg), es(search.summaryMsg)]).toEqual([
      'Pesquisar “vitest”',
      'Search “vitest”',
      'Buscar “vitest”',
    ]);
    const bare = describePermission('Bash', {});
    expect([bare.summary, en(bare.summaryMsg)]).toEqual(['Executar um comando', 'Run a command']);
  });

  test('suggestion labels keep the pt-BR text and localize the scope', () => {
    const rule = describeSuggestion({
      type: 'addRules',
      behavior: 'allow',
      destination: 'localSettings',
      rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
    });
    expect([rule.label, en(rule.msg), es(rule.msg)]).toEqual([
      'Sempre permitir Bash(npm test:*) neste projeto',
      'Always allow Bash(npm test:*) for this project',
      'Permitir siempre Bash(npm test:*) en este proyecto',
    ]);
    const deny = describeSuggestion({
      type: 'addRules',
      behavior: 'deny',
      destination: 'userSettings',
      rules: [{ toolName: 'Read' }],
    });
    expect([deny.label, en(deny.msg)]).toEqual(['Sempre recusar Read sempre', 'Always deny Read always']);
    const mode = describeSuggestion({ type: 'setMode', mode: 'acceptEdits', destination: 'session' });
    expect([mode.label, en(mode.msg), es(mode.msg)]).toEqual([
      'Mudar para o modo acceptEdits nesta sessão',
      'Switch to acceptEdits mode for this session',
      'Cambiar al modo acceptEdits en esta sesión',
    ]);
    const dirs = describeSuggestion({ type: 'addDirectories', directories: ['/a', '/b'] });
    expect([dirs.label, en(dirs.msg)]).toEqual(['Permitir acesso a /a, /b', 'Allow access to /a, /b']);
    const fallback = describeSuggestion(42);
    expect([fallback.label, en(fallback.msg), es(fallback.msg)]).toEqual([
      'Lembrar esta decisão',
      'Remember this decision',
      'Recordar esta decisión',
    ]);
    expect(en(describeSuggestion({ type: 'setMode' }).msg)).toBe('Switch to new mode');
  });
});

describe('status reasons', () => {
  const base = { now: 1_000_000, turn: 'idle' as const, lastEventAt: 999_000, permissionPending: false };

  test('generated waiting reasons carry a message; attention without one stays plain', () => {
    expect(deriveStatus({ ...base, attentionMessage: 'Precisa de você', attentionMsg: NEEDS_YOU_MSG })).toEqual({
      status: 'waiting',
      waitingFor: 'Precisa de você',
      waitingForMsg: { key: 'waiting.needsYou' },
    });
    expect(deriveStatus({ ...base, registryStatus: 'waiting', turn: 'working' })).toMatchObject({
      status: 'waiting',
      waitingFor: 'Precisa de você',
      waitingForMsg: { key: 'waiting.needsYou' },
    });
    const approve = deriveStatus({
      ...base,
      registryStatus: 'waiting',
      turn: 'working',
      blockingTool: { name: 'Bash', at: 0 },
    });
    expect([approve.waitingFor, en(approve.waitingForMsg), es(approve.waitingForMsg)]).toEqual([
      'Aprovar Bash',
      'Approve Bash',
      'Aprobar Bash',
    ]);
    expect(deriveStatus({ ...base, attentionMessage: 'texto livre' })).toEqual({
      status: 'waiting',
      waitingFor: 'texto livre',
    });
  });
});

describe('accounts', () => {
  test('only ~/.claude is the default account, keeping the pt-BR label', () => {
    const accounts = accountsFromDirs(['/home/u/.claude-work', '/home/u/.claude'], '/home/u');
    expect(accounts.map((a) => [a.label, a.isDefault])).toEqual([
      ['Pessoal', true],
      ['work', undefined],
    ]);
    expect(translateShared('en', { key: 'account.default' })).toBe('Personal');
    expect(translateShared('es', { key: 'account.default' })).toBe('Personal');
  });
});

describe('message locale', () => {
  let clock = 1000;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1000;
  });
  afterEach(() => vi.useRealTimers());

  test('the sender locale is stored on the message and handed to the hook with it', () => {
    const registry = new MessageRegistry({ now: () => clock, onChange: () => undefined, onDelivered: () => undefined });
    const [withLocale] = registry.send(['a1'], 'Run the tests', 'en');
    expect(withLocale).toMatchObject({ locale: 'en' });
    registry.send(['a1'], 'sem idioma');
    const taken = registry.take('a1', 'tool');
    expect(taken.map((m) => m.locale)).toEqual(['en', undefined]);
    expect('locale' in (taken[1] as object)).toBe(false);
  });
});

describe('transcript system entries', () => {
  let fake: FakeClaudeDir;
  beforeEach(async () => {
    fake = await makeFakeClaude();
  });
  afterEach(async () => {
    await fake.cleanup();
  });

  test('interruptions and compactions carry a message', async () => {
    const path = await fake.writeTranscript(
      's1',
      jsonl(
        userLine('oi', 0),
        JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: new Date(T0).toISOString() }),
        userLine('[Request interrupted by user]', 5),
      ),
    );
    const view = new TranscriptView(path);
    await view.update();
    const system = view.page(undefined).entries.flatMap((entry) => (entry.kind === 'system' ? [entry] : []));
    expect(system.map((entry) => [entry.text, en(entry.msg), es(entry.msg)])).toEqual([
      ['Conversa compactada', 'Conversation compacted', 'Conversación compactada'],
      ['Interrompido pelo usuário', 'Interrupted by the user', 'Interrumpido por el usuario'],
    ]);
  });
});

describe('office model messages', () => {
  let fake: FakeClaudeDir;
  let clock: number;
  let feed: FeedItem[];
  let notices: Notice[];
  let office: Office;
  let engine: Engine;

  function build(): void {
    feed = [];
    notices = [];
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
      },
    });
    engine = new Engine({
      discover: { homeDir: fake.home, explicitDirs: undefined, envDir: undefined },
      office,
      log: silentLogger,
      now: () => clock,
      pidAlive: () => true,
    });
  }

  beforeEach(async () => {
    fake = await makeFakeClaude();
    clock = T0 + 60_000;
  });
  afterEach(async () => {
    engine.stop();
    await fake.cleanup();
  });

  test('agents and activities carry the messages next to their pt-BR texts', async () => {
    await fake.writeRegistry(100, { sessionId: 's1', status: 'busy', statusUpdatedAt: T0 + 59_000 });
    await fake.writeTranscript(
      's1',
      jsonl(
        userLine('go', 58_000),
        assistantLine([toolUse('t1', 'Edit', { file_path: '/work/proj/src/a.ts' })], 58_500),
      ),
    );
    await fake.writeSubagent(
      's1',
      'ag2',
      jsonl(assistantLine([toolUse('r', 'Grep', { pattern: 'foo' })], 59_000, { extra: { agentId: 'ag2' } })),
    );
    build();
    await engine.scan();
    const main = office.state().agents.find((agent) => agent.kind === 'main');
    expect(main).toMatchObject({
      role: 'Principal',
      roleMsg: { key: 'agent.role.main' },
      activity: { text: 'Editando a.ts', msg: { key: 'activity.edit', params: { file: 'a.ts' } } },
    });
    expect(en(main?.activity?.msg)).toBe('Editing a.ts');
    expect(es(main?.roleMsg)).toBe('Principal');
    expect(en(main?.roleMsg)).toBe('Main');
    const sub = office.state().agents.find((agent) => agent.kind === 'sub');
    expect(sub).toMatchObject({ role: 'Subagente', roleMsg: { key: 'agent.role.sub' } });
    expect(en(sub?.roleMsg)).toBe('Subagent');
    expect(feed.every((item) => item.activity.msg !== undefined)).toBe(true);
  });

  test('a pending question and its alert are localizable', async () => {
    await fake.writeRegistry(100, { sessionId: 's1', status: 'busy', statusUpdatedAt: T0 + 59_000 });
    await fake.writeTranscript(
      's1',
      jsonl(userLine('go', 58_000), assistantLine([toolUse('q', 'AskUserQuestion', { questions: [] })], 58_500)),
    );
    build();
    await engine.scan();
    const agent = office.state().agents[0];
    expect(agent).toMatchObject({ status: 'waiting', waitingFor: 'Responder uma pergunta' });
    expect([en(agent?.waitingForMsg), es(agent?.waitingForMsg)]).toEqual([
      'Answer a question',
      'Responder una pregunta',
    ]);
  });

  test('a stuck tool raises an alert notice built from nested messages', async () => {
    await fake.writeRegistry(100, { sessionId: 's1', status: 'busy', statusUpdatedAt: T0 + 1000 });
    await fake.writeTranscript(
      's1',
      jsonl(userLine('go', 58_000), assistantLine([toolUse('b', 'Bash', { command: 'rm -rf x' })], 58_500)),
    );
    build();
    await engine.scan();
    await fake.writeRegistry(100, { sessionId: 's1', status: 'idle', statusUpdatedAt: T0 + 59_000 });
    clock = T0 + 70_000;
    await engine.scan();
    const alert = notices.find((notice) => notice.level === 'alert') as Notice;
    expect(alert.text).toMatch(/ precisa de você: Aprovar Bash$/);
    expect(alert.msg?.key).toBe('notice.needs.detail');
    expect(en(alert.msg)).toMatch(/ needs you: Approve Bash$/);
    expect(es(alert.msg)).toMatch(/ te necesita: Aprobar Bash$/);
    expect(pt(alert.msg)).toBe(alert.text);
  });

  test('turn completion and leaving notices carry messages, with the duration nested', async () => {
    await fake.writeRegistry(100, { sessionId: 's1', status: 'busy', statusUpdatedAt: T0 + 59_000 });
    await fake.writeTranscript(
      's1',
      jsonl(
        userLine('go', 10_000),
        assistantLine([{ type: 'text', text: 'pronto' }], 82_000, { stopReason: 'end_turn' }),
      ),
    );
    build();
    await engine.scan();
    await engine.scan();
    const done = notices.find((notice) => notice.level === 'success') as Notice;
    expect(done.text).toMatch(/ concluiu em 1 min 12 s$/);
    expect(en(done.msg)).toMatch(/ finished in 1 min 12 s$/);
    expect(es(done.msg)).toMatch(/ terminó en 1 min 12 s$/);
    for (const notice of notices) {
      expect(notice.msg, notice.text).toBeDefined();
      expect(pt(notice.msg)).toBe(notice.text);
    }
  });
});
