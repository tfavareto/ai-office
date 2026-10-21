import { describe, expect, test } from 'vitest';
import {
  ACTIVITY_DETAIL_MAX,
  ACTIVITY_TEXT_MAX,
  type ActivityDraft,
  describeToolUse,
  doneDraft,
  durationMsg,
  errorDraft,
  localizeDraft,
  messageDraft,
  permissionDraft,
  promptDraft,
  replyDraft,
  thinkingDraft,
} from './activities';
import { formatDuration, truncate } from './format';
import { msg, sourceText, translateShared } from './i18n';
import type { ActivityKind } from './model';

const ALL_KINDS: readonly ActivityKind[] = [
  'prompt',
  'think',
  'reply',
  'read',
  'search',
  'edit',
  'write',
  'bash',
  'web',
  'task',
  'subagent',
  'mcp',
  'question',
  'permission',
  'message',
  'error',
  'done',
  'other',
];

const SAMPLES: readonly ActivityDraft[] = [
  describeToolUse('Read', { file_path: '/p/src/App.tsx' }),
  describeToolUse('Read', {}),
  describeToolUse('Edit', { file_path: '/p/a.ts' }),
  describeToolUse('Write', { file_path: '/p/c.ts' }),
  describeToolUse('Bash', { command: 'npm test', description: 'Rodando os testes' }),
  describeToolUse('Bash', { command: 'npm test\nsecond line' }),
  describeToolUse('Bash', {}),
  describeToolUse('BashOutput', {}),
  describeToolUse('KillShell', {}),
  describeToolUse('Monitor', { description: 'logs' }),
  describeToolUse('Monitor', {}),
  describeToolUse('Grep', { pattern: 'foo' }),
  describeToolUse('Grep', { pattern: 'foo', path: 'src' }),
  describeToolUse('WebFetch', { url: 'https://www.exemplo.com.br/x' }),
  describeToolUse('WebSearch', { query: 'vitest' }),
  describeToolUse('Agent', { description: 'Mapear módulos' }),
  describeToolUse('Task', {}),
  describeToolUse('TodoWrite', {}),
  describeToolUse('AskUserQuestion', {}),
  describeToolUse('ExitPlanMode', { plan: 'passos' }),
  describeToolUse('EnterPlanMode', {}),
  describeToolUse('Skill', { skill: 'review' }),
  describeToolUse('Skill', {}),
  describeToolUse('ToolSearch', { query: 'slack' }),
  describeToolUse('mcp__github__list_issues', {}),
  describeToolUse('Algo', {}),
  thinkingDraft(),
  replyDraft('texto'),
  promptDraft('Adicionar cupom de desconto no carrinho de compras da loja online agora'),
  errorDraft('Bash', 'falhou'),
  doneDraft(65_000),
  messageDraft('oi'),
  permissionDraft('npm test'),
  permissionDraft('Editar src/a.ts', msg('perm.edit', { file: 'src/a.ts' })),
];

describe('activity drafts carry a message', () => {
  test('every activity kind is covered by the samples', () => {
    expect(new Set(SAMPLES.map((sample) => sample.kind))).toEqual(new Set(ALL_KINDS));
  });

  test.each(SAMPLES.map((sample) => [sample.text, sample] as const))(
    'the pt-BR rendering of the message is the text: %s',
    (_text, sample) => {
      expect(sample.text).toBe(truncate(sourceText(sample.msg), ACTIVITY_TEXT_MAX));
    },
  );

  test.each(SAMPLES.map((sample) => [sample.text, sample] as const))(
    'en and es render the message without leaking the key: %s',
    (_text, sample) => {
      for (const locale of ['en', 'es'] as const) {
        const rendered = translateShared(locale, sample.msg);
        expect(rendered).not.toBe(sample.msg.key);
        expect(rendered).not.toMatch(/[{}]/);
        expect(rendered).not.toMatch(/^[a-z]+(\.[a-z]+)+$/);
      }
    },
  );

  test('data stays untranslated in every language: file names, hosts, commands and queries are params', () => {
    const read = describeToolUse('Read', { file_path: '/p/src/App.tsx' });
    expect(translateShared('en', read.msg)).toBe('Reading App.tsx');
    expect(translateShared('es', read.msg)).toBe('Leyendo App.tsx');
    expect(translateShared('en', describeToolUse('WebFetch', { url: 'https://www.exemplo.com.br/x' }).msg)).toBe(
      'Fetching exemplo.com.br',
    );
    expect(translateShared('es', describeToolUse('WebSearch', { query: 'vitest' }).msg)).toBe(
      'Buscando en la web “vitest”',
    );
    for (const locale of ['pt-BR', 'en', 'es'] as const) {
      expect(
        translateShared(locale, describeToolUse('Bash', { command: 'npm test', description: 'Rodando os testes' }).msg),
      ).toBe('Rodando os testes');
      expect(translateShared(locale, describeToolUse('mcp__github__list_issues', {}).msg)).toBe('github: list_issues');
    }
  });

  test('generic fallbacks are messages too ("arquivo", "um comando", "processo")', () => {
    expect(translateShared('en', describeToolUse('Read', {}).msg)).toBe('Reading file');
    expect(translateShared('es', describeToolUse('Read', {}).msg)).toBe('Leyendo archivo');
    expect(translateShared('en', describeToolUse('Bash', {}).msg)).toBe('Running a command');
    expect(translateShared('en', describeToolUse('Monitor', {}).msg)).toBe('Monitoring: process');
    expect(translateShared('es', describeToolUse('Task', {}).msg)).toBe('Delegando: una tarea');
    expect(describeToolUse('Read', {}).text).toBe('Lendo arquivo');
  });

  test('generated details come with a detailMsg; data details do not', () => {
    const search = describeToolUse('Grep', { pattern: 'foo', path: 'src' });
    expect(search.detail).toBe('foo em src');
    expect(search.detailMsg).toEqual(msg('activity.search.detail', { pattern: 'foo', path: 'src' }));
    expect(translateShared('en', search.detailMsg as never)).toBe('foo in src');
    expect(describeToolUse('Grep', { pattern: 'foo' }).detailMsg).toBeUndefined();
    expect(describeToolUse('Bash', { command: 'ls' }).detailMsg).toBeUndefined();
    expect(describeToolUse('Read', { file_path: '/p/a.ts' }).detailMsg).toBeUndefined();
    expect(permissionDraft('npm test').detailMsg).toBeUndefined();
    const generated = permissionDraft('Editar src/a.ts', msg('perm.edit', { file: 'src/a.ts' }));
    expect(generated.detail).toBe('Editar src/a.ts');
    expect(translateShared('en', generated.detailMsg as never)).toBe('Edit src/a.ts');
    expect(translateShared('en', generated.msg)).toBe('Requesting permission: Edit src/a.ts');
  });

  test('message parameters stay bounded', () => {
    const long = describeToolUse('Bash', { command: 'x'.repeat(2000), description: 'd'.repeat(500) });
    expect(JSON.stringify(long.msg).length).toBeLessThan(400);
    expect(long.text.length).toBeLessThanOrEqual(ACTIVITY_TEXT_MAX);
    expect(long.detail?.length ?? 0).toBeLessThanOrEqual(ACTIVITY_DETAIL_MAX);
  });

  test('a user prompt is cut in the message exactly as in the text', () => {
    const prompt = promptDraft('Adicionar cupom de desconto no carrinho de compras da loja online agora');
    expect(prompt.msg.params).toEqual({ prompt: 'Adicionar cupom de desconto no carrinho…' });
    expect(translateShared('en', prompt.msg)).toBe('New task: “Adicionar cupom de desconto no carrinho…”');
  });

  test('a generated (demo) prompt nests its message and keeps the same pt-BR text', () => {
    const generated = {
      text: 'Corrigir o cálculo do frete para pedidos internacionais',
      msg: msg('demo.prompt.store.2'),
    };
    const draft = promptDraft(generated);
    expect(draft.text).toBe('Nova tarefa: “Corrigir o cálculo do frete para pedido…”');
    expect(draft.detail).toBe(generated.text);
    expect(draft.detailMsg).toEqual(generated.msg);
    expect(translateShared('en', draft.msg)).toBe('New task: “Fix shipping cost for international orders”');
    expect(translateShared('es', draft.detailMsg as never)).toBe(
      'Corregir el cálculo del envío en pedidos internacionales',
    );
  });

  test('localizeDraft swaps the message and the pt-BR text together', () => {
    const swapped = localizeDraft(
      describeToolUse('Bash', { command: 'npm test' }),
      msg('activity.bash.run', { text: msg('demo.cmd.test') }),
    );
    expect(swapped).toMatchObject({ kind: 'bash', text: 'Rodando os testes', detail: 'npm test' });
    expect(translateShared('en', swapped.msg)).toBe('Running the tests');
  });
});

describe('durations are nested messages', () => {
  test.each([0, 400, 999, 42_000, 59_499, 60_000, 65_000, 3_599_000, 3_600_000, 4_800_000, 90_000_000])(
    '%d ms renders like formatDuration in pt-BR',
    (ms) => {
      expect(sourceText(durationMsg(ms))).toBe(formatDuration(ms));
    },
  );

  test('"Concluiu em" nests the duration and works in every language', () => {
    const done = doneDraft(65_000);
    expect(done).toMatchObject({ text: 'Concluiu em 1 min 05 s', durationMs: 65_000 });
    expect(done.msg).toEqual({
      key: 'activity.done',
      params: { duration: { key: 'duration.minutes', params: { m: 1, s: '05' } } },
    });
    expect(translateShared('en', done.msg)).toBe('Finished in 1 min 05 s');
    expect(translateShared('es', done.msg)).toBe('Terminó en 1 min 05 s');
    expect(translateShared('en', doneDraft(42_000).msg)).toBe('Finished in 42 s');
    expect(translateShared('en', doneDraft(4_800_000).msg)).toBe('Finished in 1 h 20 min');
  });
});
