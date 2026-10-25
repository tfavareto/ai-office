// Synthetic Codex rollouts for tests: the record shapes the CLI and the app write, with made-up content only.
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { T0, iso, makeTempDir, removeDir } from '../test-helpers';

export const CWD = '/work/codex-proj';
export const THREAD = '0199aaaa-bbbb-7ccc-8ddd-000000000001';

export function record(type: string, payload: Record<string, unknown>, offsetMs: number): string {
  return JSON.stringify({ timestamp: iso(offsetMs), type, payload });
}

export function sessionMeta(offsetMs: number, extra: Record<string, unknown> = {}): string {
  return record(
    'session_meta',
    {
      id: THREAD,
      timestamp: iso(offsetMs),
      cwd: CWD,
      originator: 'codex_cli_rs',
      cli_version: '0.160.0',
      source: 'cli',
      model_provider: 'openai',
      git: { branch: 'feature-x', commit_hash: 'abc', repository_url: 'https://example.invalid/r.git' },
      ...extra,
    },
    offsetMs,
  );
}

export function turnContext(offsetMs: number, extra: Record<string, unknown> = {}): string {
  return record(
    'turn_context',
    {
      cwd: CWD,
      model: 'gpt-5.6-sol',
      approval_policy: 'on-request',
      sandbox_policy: { type: 'workspace-write' },
      turn_id: 't1',
      ...extra,
    },
    offsetMs,
  );
}

export const event = (kind: string, offsetMs: number, payload: Record<string, unknown> = {}): string =>
  record('event_msg', { type: kind, ...payload }, offsetMs);

export const responseItem = (kind: string, offsetMs: number, payload: Record<string, unknown> = {}): string =>
  record('response_item', { type: kind, ...payload }, offsetMs);

export const taskStarted = (offsetMs: number): string => event('task_started', offsetMs, { turn_id: 't1' });
export const taskComplete = (offsetMs: number): string => event('task_complete', offsetMs, { turn_id: 't1' });
export const userMessage = (message: string, offsetMs: number): string =>
  event('user_message', offsetMs, { message, kind: 'plain' });

export function itemCompleted(item: Record<string, unknown>, offsetMs: number): string {
  return event('item_completed', offsetMs, { thread_id: THREAD, turn_id: 't1', item });
}

export const assistantMessage = (text: string, offsetMs: number): string =>
  responseItem('message', offsetMs, { role: 'assistant', content: [{ type: 'output_text', text }] });

export const reasoning = (offsetMs: number, summary = ''): string =>
  responseItem('reasoning', offsetMs, {
    summary: summary === '' ? [] : [{ type: 'summary_text', text: summary }],
    encrypted_content: 'x',
  });

export function shellCall(callId: string, command: string[], offsetMs: number): string {
  return responseItem('function_call', offsetMs, {
    name: 'shell',
    call_id: callId,
    arguments: JSON.stringify({ command, workdir: CWD }),
  });
}

export function functionOutput(callId: string, output: string, offsetMs: number, exitCode?: number): string {
  const body = exitCode === undefined ? output : JSON.stringify({ output, metadata: { exit_code: exitCode } });
  return responseItem('function_call_output', offsetMs, { call_id: callId, output: body });
}

export function tokenCount(total: Partial<Record<string, number>>, offsetMs: number): string {
  const input = total.input_tokens ?? 0;
  const output = total.output_tokens ?? 0;
  const usage = {
    input_tokens: input,
    cached_input_tokens: total.cached_input_tokens ?? 0,
    cache_write_input_tokens: total.cache_write_input_tokens ?? 0,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: input + output,
  };
  return event('token_count', offsetMs, {
    info: { total_token_usage: usage, last_token_usage: usage },
    rate_limits: null,
  });
}

export function applyPatch(callId: string, patch: string, offsetMs: number): string {
  return responseItem('custom_tool_call', offsetMs, {
    name: 'apply_patch',
    call_id: callId,
    input: patch,
    status: 'completed',
  });
}

export const PATCH = [
  '*** Begin Patch',
  '*** Add File: src/new.ts',
  '+export const a = 1;',
  '+export const b = 2;',
  '*** Update File: src/old.ts',
  '@@',
  '-const x = 1;',
  '+const x = 2;',
  '+const y = 3;',
  '*** Delete File: src/gone.ts',
  '*** End Patch',
].join('\n');

export function rolloutName(offsetMs: number, threadId: string): string {
  return `rollout-${iso(offsetMs).slice(0, 19).replace(/:/g, '-')}-${threadId}.jsonl`;
}

export interface FakeCodexHome {
  home: string;
  dir: string;
  write(threadId: string, content: string, day?: string): Promise<string>;
  append(path: string, content: string): Promise<void>;
  cleanup(): Promise<void>;
}

/** A temporary `.codex` with `sessions/YYYY/MM/DD`; `day` is the folder (default: the test's day). */
export async function makeFakeCodex(): Promise<FakeCodexHome> {
  const home = await makeTempDir('ai-office-codex-');
  const dir = join(home, '.codex');
  await mkdir(join(dir, 'sessions'), { recursive: true });
  const defaultDay = new Date(T0).toISOString().slice(0, 10).replace(/-/g, '/');
  return {
    home,
    dir,
    async write(threadId, content, day = defaultDay) {
      const folder = join(dir, 'sessions', day);
      await mkdir(folder, { recursive: true });
      const path = join(folder, rolloutName(0, threadId));
      await writeFile(path, content);
      return path;
    },
    append: (path, content) => appendFile(path, content),
    cleanup: () => removeDir(home),
  };
}
