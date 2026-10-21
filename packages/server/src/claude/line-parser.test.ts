import { describe, expect, test } from 'vitest';
import { assistantLine, iso, text, thinking, toolResultLine, toolUse, userLine } from '../test-helpers';
import { parseLine } from './line-parser';

describe('parseLine', () => {
  test('returns undefined for garbage, empty and irrelevant lines', () => {
    expect(parseLine('')).toBeUndefined();
    expect(parseLine('not json')).toBeUndefined();
    expect(parseLine('{"type":"file-history-snapshot"}')).toBeUndefined();
    expect(parseLine('{broken')).toBeUndefined();
    expect(parseLine('[1,2]')).toBeUndefined();
    expect(parseLine(JSON.stringify({ type: 'user', message: { content: 'sem data' } }))).toBeUndefined();
  });

  test('parses a user prompt with metadata', () => {
    const line = parseLine(userLine('Faça isso', 1000, { gitBranch: 'feat/x' }));
    expect(line).toMatchObject({
      kind: 'prompt',
      text: 'Faça isso',
      cwd: '/work/proj',
      gitBranch: 'feat/x',
      permissionMode: 'default',
    });
    expect(line && 'at' in line && line.at).toBe(Date.parse(iso(1000)));
  });

  test('ignores meta, system-reminder and local command user lines', () => {
    expect(parseLine(userLine('x', 0, { isMeta: true }))).toBeUndefined();
    expect(parseLine(userLine('<system-reminder>algo</system-reminder>', 0))).toBeUndefined();
    expect(parseLine(userLine('<local-command-stdout>ok</local-command-stdout>', 0))).toBeUndefined();
  });

  test('turns slash commands into prompts and detects interruptions', () => {
    expect(
      parseLine(userLine('<command-name>/review</command-name><command-args>PR 12</command-args>', 0)),
    ).toMatchObject({ kind: 'prompt', text: '/review PR 12' });
    expect(parseLine(userLine('[Request interrupted by user]', 0))?.kind).toBe('interrupt');
  });

  test('parses assistant blocks, usage with cache split and stop reason', () => {
    const line = parseLine(
      assistantLine([thinking('x'), text('olá'), toolUse('t1', 'Read', { file_path: '/a.ts' })], 5, {
        id: 'm1',
        stopReason: 'tool_use',
        usage: {
          input_tokens: 3,
          output_tokens: 4,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 20,
          cache_creation: { ephemeral_5m_input_tokens: 6, ephemeral_1h_input_tokens: 4 },
        },
      }),
    );
    expect(line).toMatchObject({
      kind: 'assistant',
      messageId: 'm1',
      model: 'claude-sonnet-5-5',
      stopReason: 'tool_use',
      usage: { input: 3, output: 4, cacheWrite5m: 6, cacheWrite1h: 4, cacheRead: 20 },
    });
    expect(line?.kind === 'assistant' && line.blocks.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
  });

  test('synthetic models carry no usage', () => {
    const line = parseLine(assistantLine([text('erro')], 0, { model: '<synthetic>' }));
    expect(line?.kind === 'assistant' && line.usage).toBeUndefined();
    expect(line?.kind === 'assistant' && line.model).toBeUndefined();
  });

  test('parses tool results with structured patch line counts', () => {
    const line = parseLine(
      toolResultLine('t1', 'ok', 10, { toolUseResult: { structuredPatch: [{ lines: [' a', '+b', '+c', '-d'] }] } }),
    );
    expect(line).toMatchObject({
      kind: 'tool-results',
      results: [{ toolUseId: 't1', text: 'ok', isError: false }],
      structured: { linesAdded: 2, linesRemoved: 1, asyncAgent: false },
    });
  });

  test('flattens block content, flags errors and detects async agent launches', () => {
    const raw = JSON.stringify({
      type: 'user',
      timestamp: iso(0),
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'a',
            is_error: true,
            content: [{ type: 'text', text: 'falhou' }, { type: 'image' }],
          },
        ],
      },
      toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'ag1', backgroundTaskId: 'bg1' },
    });
    expect(parseLine(raw)).toMatchObject({
      results: [{ text: 'falhou\n[imagem]', isError: true }],
      structured: { asyncAgent: true, agentId: 'ag1', backgroundTaskId: 'bg1' },
    });
  });

  test('counts created file lines for Write results', () => {
    const line = parseLine(
      toolResultLine('w', 'ok', 0, { toolUseResult: { type: 'create', content: 'a\nb\nc', structuredPatch: [] } }),
    );
    expect(line?.kind === 'tool-results' && line.structured?.linesAdded).toBe(3);
  });

  test('parses task notifications from queue operations, attachments and user lines', () => {
    const body =
      '<task-notification>\n<task-id>bg1</task-id>\n<tool-use-id>tu1</tool-use-id>\n<status>completed</status>\n<summary>Pronto</summary>\n</task-notification>';
    const fromQueue = parseLine(
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(0), content: body }),
    );
    const fromAttachment = parseLine(
      JSON.stringify({ type: 'attachment', timestamp: iso(0), attachment: { type: 'queued_command', prompt: body } }),
    );
    const fromUser = parseLine(userLine(body, 0));
    for (const line of [fromQueue, fromAttachment, fromUser]) {
      expect(line).toMatchObject({
        kind: 'notification',
        toolUseId: 'tu1',
        taskId: 'bg1',
        status: 'completed',
        summary: 'Pronto',
      });
    }
  });

  test('parses titles, last prompt, mode and cost-state lines', () => {
    expect(parseLine('{"type":"custom-title","customTitle":" Meu título "}')).toEqual({
      kind: 'title',
      title: 'Meu título',
    });
    expect(parseLine('{"type":"last-prompt","lastPrompt":"oi"}')).toEqual({ kind: 'last-prompt', text: 'oi' });
    expect(parseLine('{"type":"mode","mode":"plan"}')).toEqual({ kind: 'mode', mode: 'plan' });
    expect(parseLine('{"type":"cost-state","totalCostUSD":3.5,"totalLinesAdded":10,"totalLinesRemoved":2}')).toEqual({
      kind: 'cost-state',
      costUSD: 3.5,
      linesAdded: 10,
      linesRemoved: 2,
    });
    expect(parseLine('{"type":"custom-title","customTitle":""}')).toBeUndefined();
  });

  test('parses system lines', () => {
    const line = parseLine(
      JSON.stringify({
        type: 'system',
        subtype: 'compact_boundary',
        timestamp: iso(0),
        content: 'Conversa compactada',
      }),
    );
    expect(line).toMatchObject({ kind: 'system', subtype: 'compact_boundary', text: 'Conversa compactada' });
  });
});
