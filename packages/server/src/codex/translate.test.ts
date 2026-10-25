import { describe, expect, test } from 'vitest';
import type { ParsedLine } from '../claude/types';
import { T0 } from '../test-helpers';
import {
  CWD,
  PATCH,
  THREAD,
  applyPatch,
  assistantMessage,
  event,
  functionOutput,
  itemCompleted,
  reasoning,
  record,
  responseItem,
  sessionMeta,
  shellCall,
  taskComplete,
  taskStarted,
  tokenCount,
  turnContext,
  userMessage,
} from './fixtures';
import { RolloutTranslator } from './translate';

function run(...rows: string[]): ParsedLine[] {
  const translator = new RolloutTranslator();
  return rows.flatMap((row) => translator.translate(row));
}

const kinds = (lines: ParsedLine[]): string[] => lines.map((line) => line.kind);
const toolUses = (lines: ParsedLine[]) =>
  lines.flatMap((line) => (line.kind === 'assistant' ? line.blocks.filter((block) => block.type === 'tool_use') : []));

describe('session facts', () => {
  test('session_meta gives the folder and branch to every later line', () => {
    const lines = run(sessionMeta(0), userMessage('olá', 1000));
    expect(lines[0]).toMatchObject({
      kind: 'system',
      subtype: 'session_meta',
      at: T0,
      cwd: CWD,
      gitBranch: 'feature-x',
    });
    expect(lines[1]).toMatchObject({ kind: 'prompt', text: 'olá', cwd: CWD, gitBranch: 'feature-x' });
  });

  test('turn_context sets the model and the permission mode', () => {
    const lines = run(turnContext(0), assistantMessage('pronto', 1000));
    expect(lines[1]).toMatchObject({
      kind: 'assistant',
      model: 'gpt-5.6-sol',
      permissionMode: 'on-request · workspace-write',
    });
  });

  test('a detached HEAD is not a branch', () => {
    const lines = run(sessionMeta(0, { git: { branch: 'HEAD' } }), userMessage('x', 10));
    expect(lines[1]).not.toHaveProperty('gitBranch');
  });
});

describe('turns', () => {
  test('task_started and task_complete open and close a turn', () => {
    expect(kinds(run(taskStarted(0), taskComplete(5000)))).toEqual(['turn-start', 'turn-end']);
  });

  test('turn_aborted is an interruption', () => {
    expect(run(event('turn_aborted', 0, { reason: 'interrupted' }))[0]).toMatchObject({ kind: 'interrupt' });
  });
});

describe('prompts', () => {
  test('the CLI user_message and the app UserMessage item are prompts', () => {
    const lines = run(
      userMessage('um', 0),
      itemCompleted({ type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: 'dois' }] }, 5000),
    );
    expect(lines.map((line) => (line.kind === 'prompt' ? line.text : ''))).toEqual(['um', 'dois']);
  });

  test('injected context is not a prompt', () => {
    const lines = run(
      userMessage('<environment_context>\n  <cwd>/x</cwd>\n</environment_context>', 0),
      userMessage('# AGENTS.md instructions for /x', 10),
      userMessage('   ', 20),
      responseItem('message', 30, { role: 'user', content: [{ type: 'input_text', text: 'ignored' }] }),
    );
    expect(lines).toEqual([]);
  });

  test('the same prompt reported twice at once counts once', () => {
    const lines = run(
      userMessage('mesma', 0),
      itemCompleted({ type: 'UserMessage', id: 'u', content: [{ type: 'text', text: 'mesma' }] }, 500),
    );
    expect(kinds(lines)).toEqual(['prompt']);
  });
});

describe('replies and thinking', () => {
  test('assistant messages are replies; reasoning is thinking', () => {
    const lines = run(assistantMessage('Feito.', 0), reasoning(10, 'pensando'), reasoning(20));
    expect(lines[0]).toMatchObject({ kind: 'assistant', blocks: [{ type: 'text', text: 'Feito.' }] });
    expect(lines[1]).toMatchObject({ blocks: [{ type: 'thinking', text: 'pensando' }] });
    expect(lines[2]).toMatchObject({ blocks: [{ type: 'thinking', text: '' }] });
  });

  test('empty messages and other roles are dropped', () => {
    const lines = run(
      assistantMessage('  ', 0),
      responseItem('message', 10, { role: 'developer', content: [{ type: 'input_text', text: 'regras' }] }),
    );
    expect(lines).toEqual([]);
  });
});

describe('shell commands', () => {
  test('a shell function call is a Bash tool use that its output answers', () => {
    const lines = run(
      shellCall('c1', ['bash', '-lc', 'npm test'], 0),
      functionOutput('c1', 'ok', 500, 0),
      shellCall('c2', ['false'], 1000),
      functionOutput('c2', 'boom', 1500, 1),
    );
    expect(toolUses(lines)).toMatchObject([
      { id: 'c1', name: 'Bash', input: { command: 'npm test' } },
      { id: 'c2', name: 'Bash', input: { command: 'false' } },
    ]);
    const results = lines.flatMap((line) => (line.kind === 'tool-results' ? line.results : []));
    expect(results).toEqual([
      { toolUseId: 'c1', text: 'ok', isError: false },
      { toolUseId: 'c2', text: 'boom', isError: true },
    ]);
  });

  test('plain text outputs are not errors', () => {
    const lines = run(shellCall('c', ['ls'], 0), functionOutput('c', 'file.txt', 10));
    expect(lines[1]).toMatchObject({ kind: 'tool-results', results: [{ text: 'file.txt', isError: false }] });
  });

  test('an output that is a list of text parts is joined', () => {
    const lines = run(
      shellCall('c', ['ls'], 0),
      responseItem('function_call_output', 10, {
        call_id: 'c',
        output: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      }),
    );
    expect(lines[1]).toMatchObject({ results: [{ text: 'a\nb' }] });
  });

  test('exec_command and local_shell calls are shell commands too', () => {
    const lines = run(
      responseItem('function_call', 0, { name: 'exec_command', call_id: 'a', arguments: '{"cmd":"git status"}' }),
      responseItem('local_shell_call', 10, {
        call_id: 'b',
        action: { type: 'exec', command: ['ls', '-la', 'my dir'] },
      }),
    );
    expect(toolUses(lines)).toMatchObject([
      { name: 'Bash', input: { command: 'git status' } },
      { name: 'Bash', input: { command: "ls -la 'my dir'" } },
    ]);
  });

  test('begin and end events of the same call are not counted twice', () => {
    const lines = run(
      shellCall('c1', ['echo', 'hi'], 0),
      event('exec_command_begin', 10, { call_id: 'c1', command: ['echo', 'hi'], cwd: CWD }),
      event('exec_command_end', 20, { call_id: 'c1', command: ['echo', 'hi'], aggregated_output: 'hi', exit_code: 0 }),
      functionOutput('c1', 'hi', 30, 0),
    );
    expect(toolUses(lines)).toHaveLength(1);
    expect(lines.filter((line) => line.kind === 'tool-results')).toHaveLength(1);
  });

  test('an end event without its begin (a file read from the middle) opens and closes the call', () => {
    const lines = run(
      event('exec_command_end', 0, { call_id: 'z', command: ['make'], aggregated_output: 'err', exit_code: 2 }),
    );
    expect(kinds(lines)).toEqual(['assistant', 'tool-results']);
    expect(lines[1]).toMatchObject({ results: [{ toolUseId: 'z', isError: true }] });
  });

  test('an output whose call was never seen is dropped', () => {
    expect(run(functionOutput('ghost', 'x', 0, 0))).toEqual([]);
  });
});

describe('file changes', () => {
  test('apply_patch becomes a Write or Edit per file, with line counts', () => {
    const lines = run(applyPatch('p1', PATCH, 0), functionOutput('p1', 'Success', 100));
    expect(toolUses(lines)).toMatchObject([
      { id: 'p1', name: 'Write', input: { file_path: 'src/new.ts' } },
      { id: 'p1#1', name: 'Edit', input: { file_path: 'src/old.ts' } },
      { id: 'p1#2', name: 'Edit', input: { file_path: 'src/gone.ts' } },
    ]);
    const structured = lines.flatMap((line) => (line.kind === 'tool-results' ? [line.structured] : []));
    expect(structured).toEqual([
      { linesAdded: 2, linesRemoved: 0, asyncAgent: false },
      { linesAdded: 2, linesRemoved: 1, asyncAgent: false },
      { linesAdded: 0, linesRemoved: 0, asyncAgent: false },
    ]);
  });

  test('relative patch paths are made absolute with the session folder', () => {
    const lines = run(sessionMeta(0), applyPatch('p', PATCH, 10));
    expect(toolUses(lines)[0]).toMatchObject({ input: { file_path: `${CWD}/src/new.ts` } });
  });

  test('the app FileChange item lists the files it touched', () => {
    const lines = run(
      itemCompleted(
        {
          type: 'FileChange',
          id: 'f1',
          status: 'completed',
          changes: {
            '/work/a.ts': { type: 'add', content: 'one\ntwo\nthree' },
            '/work/b.ts': { type: 'update', unified_diff: '--- a\n+++ b\n@@\n-old\n+new\n+newer\n', move_path: null },
          },
        },
        0,
      ),
    );
    expect(toolUses(lines)).toMatchObject([
      { name: 'Write', input: { file_path: '/work/a.ts' } },
      { name: 'Edit', input: { file_path: '/work/b.ts' } },
    ]);
    expect(
      lines.filter((line) => line.kind === 'tool-results').map((line) => (line as { structured?: unknown }).structured),
    ).toEqual([
      { linesAdded: 3, linesRemoved: 0, asyncAgent: false },
      { linesAdded: 2, linesRemoved: 1, asyncAgent: false },
    ]);
  });

  test('a failed change is an error', () => {
    const lines = run(
      itemCompleted(
        { type: 'FileChange', id: 'f', status: 'failed', changes: { '/w/x': { type: 'update', unified_diff: '' } } },
        0,
      ),
    );
    expect(lines[1]).toMatchObject({ results: [{ isError: true }] });
  });
});

describe('items of the app', () => {
  test('a command execution is a Bash call that ends at once', () => {
    const lines = run(
      itemCompleted(
        {
          type: 'CommandExecution',
          id: 'x1',
          command: ['/bin/zsh', '-lc', 'ls src'],
          exit_code: 0,
          aggregated_output: 'a.ts',
          status: 'completed',
        },
        0,
      ),
      itemCompleted(
        {
          type: 'CommandExecution',
          id: 'x2',
          command: ['/bin/zsh', '-lc', 'nope'],
          exit_code: 127,
          aggregated_output: 'not found',
          status: 'failed',
        },
        10,
      ),
    );
    expect(toolUses(lines)).toMatchObject([{ input: { command: 'ls src' } }, { input: { command: 'nope' } }]);
    expect(
      lines
        .filter((line) => line.kind === 'tool-results')
        .map((line) => (line as { results: { isError: boolean }[] }).results[0]?.isError),
    ).toEqual([false, true]);
  });

  test('MCP tool calls use the mcp__server__tool name', () => {
    const lines = run(
      itemCompleted(
        {
          type: 'McpToolCall',
          id: 'm',
          server: 'github',
          tool: 'create_pull_request',
          status: 'completed',
          result: { isError: false },
        },
        0,
      ),
    );
    expect(toolUses(lines)).toMatchObject([{ name: 'mcp__github__create_pull_request' }]);
  });

  test('web searches and page visits', () => {
    const lines = run(
      itemCompleted(
        {
          type: 'Extension',
          id: 'w1',
          kind: 'web.search',
          query: 'vitest mock',
          action: { type: 'search', query: 'vitest mock' },
          results: [],
        },
        0,
      ),
      itemCompleted(
        {
          type: 'Extension',
          id: 'w2',
          kind: 'web.search',
          action: { type: 'openPage', url: 'https://example.invalid/docs' },
          results: [],
        },
        10,
      ),
    );
    expect(toolUses(lines)).toMatchObject([
      { name: 'WebSearch', input: { query: 'vitest mock' } },
      { name: 'WebFetch', input: { url: 'https://example.invalid/docs' } },
    ]);
  });

  test('viewing an image reads a file; unknown item types are ignored', () => {
    const lines = run(
      itemCompleted({ type: 'ImageView', id: 'i', path: '/tmp/shot.png' }, 0),
      itemCompleted({ type: 'Reasoning', id: 'r', summary_text: ['x'] }, 10),
      itemCompleted({ type: 'AgentMessage', id: 'a', content: [{ text: 'dup' }] }, 20),
      itemCompleted({ type: 'SomethingNew', id: 's' }, 30),
    );
    expect(toolUses(lines)).toMatchObject([{ name: 'Read', input: { file_path: '/tmp/shot.png' } }]);
    expect(lines).toHaveLength(2);
  });
});

describe('other tool calls', () => {
  test('update_plan becomes a task list', () => {
    const lines = run(
      responseItem('function_call', 0, {
        name: 'update_plan',
        call_id: 'u',
        arguments: JSON.stringify({
          plan: [
            { step: 'Ler', status: 'completed' },
            { step: 'Editar', status: 'in_progress' },
            { step: 'Testar', status: 'weird' },
            { step: ' ' },
          ],
        }),
      }),
    );
    expect(toolUses(lines)).toMatchObject([
      {
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'Ler', status: 'completed' },
            { content: 'Editar', status: 'in_progress' },
            { content: 'Testar', status: 'pending' },
          ],
        },
      },
    ]);
  });

  test('asking the user a question, spawning an agent and viewing an image', () => {
    const lines = run(
      responseItem('function_call', 0, { name: 'request_user_input', call_id: 'q', arguments: '{}' }),
      responseItem('function_call', 10, { name: 'spawn_agent', call_id: 's', arguments: '{"agent_type":"explorer"}' }),
      responseItem('function_call', 20, { name: 'view_image', call_id: 'v', arguments: '{"path":"/a.png"}' }),
    );
    expect(toolUses(lines)).toMatchObject([
      { name: 'AskUserQuestion' },
      { name: 'Agent', input: { description: 'explorer' } },
      { name: 'Read', input: { file_path: '/a.png' } },
    ]);
  });

  test('namespaced and unknown functions keep a recognizable name; stdin writes are bookkeeping', () => {
    const lines = run(
      responseItem('function_call', 0, { name: 'js', namespace: 'mcp__node_repl', call_id: 'n', arguments: '{}' }),
      responseItem('function_call', 10, { name: 'wait', call_id: 'w', arguments: '{}' }),
      responseItem('function_call', 20, { name: 'write_stdin', call_id: 'x', arguments: '{}' }),
      responseItem('custom_tool_call', 30, { name: 'exec', call_id: 'e', input: 'tools.exec_command({})' }),
    );
    expect(toolUses(lines)).toMatchObject([{ name: 'mcp__node_repl__js' }, { name: 'wait' }]);
  });

  test('a web search call', () => {
    const lines = run(
      responseItem('web_search_call', 0, { id: 'ws', status: 'completed', action: { type: 'search', query: 'rust' } }),
    );
    expect(toolUses(lines)).toMatchObject([{ name: 'WebSearch', input: { query: 'rust' } }]);
  });

  test('legacy begin/end events for patches, MCP and searches', () => {
    const lines = run(
      event('patch_apply_begin', 0, {
        call_id: 'p',
        auto_approved: true,
        changes: { '/w/a.ts': { type: 'update', unified_diff: '+x\n' } },
      }),
      event('patch_apply_end', 10, {
        call_id: 'p',
        stdout: 'done',
        success: true,
        changes: { '/w/a.ts': { type: 'update', unified_diff: '+x\n' } },
      }),
      event('mcp_tool_call_begin', 20, { call_id: 'm', invocation: { server: 'fs', tool: 'read', arguments: {} } }),
      event('mcp_tool_call_end', 30, {
        call_id: 'm',
        invocation: { server: 'fs', tool: 'read' },
        result: { Err: 'x' },
      }),
      event('web_search_end', 40, { call_id: 'w', query: 'q' }),
    );
    expect(toolUses(lines).map((block) => block.name)).toEqual(['Edit', 'mcp__fs__read', 'WebSearch']);
    expect(lines.filter((line) => line.kind === 'tool-results')).toHaveLength(3);
    expect(lines[3]).toMatchObject({ results: [{ toolUseId: 'm', isError: true }] });
  });
});

describe('approvals', () => {
  test('a request is open until the session moves on', () => {
    const lines = run(
      shellCall('c', ['rm', '-rf', 'x'], 0),
      event('exec_approval_request', 10, { call_id: 'c', command: ['rm', '-rf', 'x'] }),
      event('exec_command_begin', 5000, { call_id: 'c', command: ['rm', '-rf', 'x'] }),
    );
    expect(lines.filter((line) => line.kind === 'approval')).toMatchObject([
      { state: 'requested', tool: 'Bash' },
      { state: 'resolved' },
    ]);
  });

  test('patch approvals, permission requests and the end of the turn', () => {
    const lines = run(
      event('apply_patch_approval_request', 0, { call_id: 'p' }),
      event('request_permissions', 10, {}),
      taskComplete(20),
    );
    expect(lines.filter((line) => line.kind === 'approval')).toMatchObject([
      { state: 'requested', tool: 'Edit' },
      { state: 'requested', tool: 'Bash' },
      { state: 'resolved' },
    ]);
  });

  test('token counts do not answer a request', () => {
    const lines = run(event('exec_approval_request', 0, {}), tokenCount({ input_tokens: 5 }, 10));
    expect(lines.filter((line) => line.kind === 'approval')).toHaveLength(1);
  });
});

describe('usage', () => {
  test('token_count carries the running totals: cached input is a cache read', () => {
    const lines = run(
      turnContext(0),
      tokenCount({ input_tokens: 1000, cached_input_tokens: 600, output_tokens: 50 }, 10),
    );
    expect(lines[1]).toMatchObject({
      kind: 'usage',
      id: 'codex-session-total',
      model: 'gpt-5.6-sol',
      usage: { input: 400, output: 50, cacheRead: 600, cacheWrite5m: 0, cacheWrite1h: 0 },
    });
  });

  test('cache writes are taken out of the fresh input', () => {
    const lines = run(
      tokenCount({ input_tokens: 1000, cached_input_tokens: 100, cache_write_input_tokens: 200, output_tokens: 1 }, 0),
    );
    expect(lines[0]).toMatchObject({ usage: { input: 700, cacheWrite5m: 200, cacheRead: 100 } });
  });

  test('a token_count without info says nothing', () => {
    expect(run(event('token_count', 0, { info: null }))).toEqual([]);
  });
});

describe('robustness', () => {
  test.each([
    ['blank', ''],
    ['not json', 'hello'],
    ['half a line', '{"timestamp":"2026-10-19T12:00:00.000Z","type":"event_msg","payload":{"type":"user_mess'],
    ['no timestamp', '{"type":"event_msg","payload":{"type":"task_started"}}'],
    ['bad timestamp', '{"timestamp":"yesterday","type":"event_msg","payload":{"type":"task_started"}}'],
    ['array', '[1,2,3]'],
    ['unknown record type', record('brand_new', { type: 'x' }, 0)],
    ['unknown event', event('something_else', 0)],
    ['skipped record', record('token_usage_record', { usage: {} }, 0)],
    ['world state', record('world_state', { full: true }, 0)],
  ])('%s yields nothing and does not throw', (_name, row) => {
    expect(run(row)).toEqual([]);
  });

  test('a record without a payload is tolerated', () => {
    expect(run(JSON.stringify({ timestamp: new Date(T0).toISOString(), type: 'event_msg' }))).toEqual([]);
  });

  test('huge lines are ignored instead of parsed', () => {
    const huge = record('event_msg', { type: 'user_message', message: 'x'.repeat(7 * 1024 * 1024) }, 0);
    expect(run(huge)).toEqual([]);
  });

  test('very long texts are cut', () => {
    const lines = run(assistantMessage('y'.repeat(50_000), 0));
    const block = lines[0]?.kind === 'assistant' ? lines[0].blocks[0] : undefined;
    expect(block?.type === 'text' ? block.text.length : 0).toBeLessThanOrEqual(8192);
  });

  test('compaction marks a boundary', () => {
    expect(run(record('compacted', { message: 'x', replacement_history: [] }, 0))[0]).toMatchObject({
      kind: 'system',
      subtype: 'compact_boundary',
    });
  });

  test('the session id of the fixture is the thread id', () => {
    expect(THREAD).toMatch(/^[0-9a-f-]{36}$/);
  });
});
