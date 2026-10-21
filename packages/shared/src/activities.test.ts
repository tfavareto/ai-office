import { describe, expect, test } from 'vitest';
import {
  ACTIVITY_DETAIL_MAX,
  ACTIVITY_TEXT_MAX,
  describeToolUse,
  doneDraft,
  errorDraft,
  messageDraft,
  parseMcpName,
  promptDraft,
  replyDraft,
  thinkingDraft,
  toActivity,
} from './activities';

describe('describeToolUse', () => {
  test('maps file tools to pt-BR sentences with the file name', () => {
    expect(describeToolUse('Read', { file_path: '/p/src/App.tsx' })).toMatchObject({
      kind: 'read',
      icon: '📖',
      text: 'Lendo App.tsx',
      detail: '/p/src/App.tsx',
    });
    expect(describeToolUse('Edit', { file_path: '/p/a.ts' })).toMatchObject({ kind: 'edit', text: 'Editando a.ts' });
    expect(describeToolUse('MultiEdit', { file_path: '/p/b.ts' }).text).toBe('Editando b.ts');
    expect(describeToolUse('Write', { file_path: '/p/c.ts' })).toMatchObject({
      kind: 'write',
      text: 'Escrevendo c.ts',
    });
  });

  test('Bash prefers the description and falls back to the command head', () => {
    expect(describeToolUse('Bash', { command: 'npm test', description: 'Rodando os testes' }).text).toBe(
      'Rodando os testes',
    );
    expect(describeToolUse('Bash', { command: 'npm test\nsecond line' }).text).toBe('npm test');
    expect(describeToolUse('Bash', {}).text).toBe('Executando um comando');
  });

  test('search, web and delegation tools', () => {
    expect(describeToolUse('Grep', { pattern: 'foo' }).text).toBe('Buscando “foo”');
    expect(describeToolUse('Glob', { pattern: '**/*.ts' }).kind).toBe('search');
    expect(describeToolUse('WebFetch', { url: 'https://www.exemplo.com.br/x' }).text).toBe(
      'Consultando exemplo.com.br',
    );
    expect(describeToolUse('WebSearch', { query: 'vitest' }).text).toBe('Pesquisando “vitest”');
    expect(describeToolUse('Agent', { description: 'Mapear módulos' })).toMatchObject({
      kind: 'subagent',
      icon: '👥',
      text: 'Delegando: Mapear módulos',
    });
    expect(describeToolUse('Task', { subagent_type: 'Explore' }).text).toBe('Delegando: Explore');
  });

  test('task, question, mcp and unknown tools', () => {
    expect(describeToolUse('TodoWrite', {}).text).toBe('Atualizando a lista de tarefas');
    expect(describeToolUse('AskUserQuestion', {})).toMatchObject({ kind: 'question', icon: '❓' });
    expect(describeToolUse('mcp__github__list_issues', {})).toMatchObject({
      kind: 'mcp',
      icon: '🔌',
      text: 'github: list_issues',
    });
    expect(describeToolUse('Algo', {}).text).toBe('Usando Algo');
  });

  test('never throws on garbage input and respects the length limits', () => {
    expect(() => describeToolUse('Read', null)).not.toThrow();
    expect(() => describeToolUse('Bash', 'texto')).not.toThrow();
    const long = describeToolUse('Bash', { command: 'x'.repeat(2000), description: 'd'.repeat(500) });
    expect(long.text.length).toBeLessThanOrEqual(ACTIVITY_TEXT_MAX);
    expect(long.detail?.length ?? 0).toBeLessThanOrEqual(ACTIVITY_DETAIL_MAX);
  });

  test('parses mcp names', () => {
    expect(parseMcpName('mcp__a__b__c')).toEqual({ server: 'a', tool: 'b__c' });
    expect(parseMcpName('Bash')).toBeUndefined();
  });
});

describe('event drafts', () => {
  test('thinking, reply, prompt, error, done and message drafts', () => {
    expect(thinkingDraft()).toMatchObject({ kind: 'think', icon: '💭', text: 'Pensando…' });
    expect(replyDraft().text).toBe('Escrevendo a resposta');
    const prompt = promptDraft('Adicionar cupom de desconto no carrinho de compras da loja online agora');
    expect(prompt.kind).toBe('prompt');
    expect(prompt.text.startsWith('Nova tarefa: “')).toBe(true);
    expect(prompt.text.length).toBeLessThanOrEqual(ACTIVITY_TEXT_MAX);
    expect(errorDraft('Bash', 'falhou')).toMatchObject({
      kind: 'error',
      error: true,
      text: 'Erro em Bash',
      detail: 'falhou',
    });
    expect(doneDraft(65_000)).toMatchObject({
      kind: 'done',
      icon: '✅',
      text: 'Concluiu em 1 min 05 s',
      durationMs: 65_000,
    });
    expect(messageDraft('oi').text).toBe('Mensagem sua: oi');
  });

  test('toActivity attaches id and timestamp', () => {
    expect(toActivity(thinkingDraft(), 'a1', 99)).toMatchObject({ id: 'a1', at: 99, kind: 'think' });
  });
});
