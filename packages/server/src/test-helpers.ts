// Shared helpers for tests: synthetic Claude Code files in temp dirs. Never uses real conversations.
import { mkdir, mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeProjectDir } from './claude/paths';

export const T0 = Date.parse('2026-10-19T12:00:00.000Z');

export function iso(offsetMs = 0): string {
  return new Date(T0 + offsetMs).toISOString();
}

export async function makeTempDir(prefix = 'ai-office-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const BASE = { userType: 'external', entrypoint: 'cli', version: '2.1.0' };

export function userLine(text: string, offsetMs: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...BASE, type: 'user', timestamp: iso(offsetMs), cwd: '/work/proj', gitBranch: 'main', permissionMode: 'default', message: { role: 'user', content: text }, ...extra });
}

export function toolResultLine(toolUseId: string, content: string, offsetMs: number, extra: Record<string, unknown> = {}, isError = false): string {
  return JSON.stringify({
    ...BASE,
    type: 'user',
    timestamp: iso(offsetMs),
    cwd: '/work/proj',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] },
    ...extra,
  });
}

export interface AssistantOptions {
  id?: string;
  model?: string;
  stopReason?: string;
  usage?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export function assistantLine(blocks: unknown[], offsetMs: number, options: AssistantOptions = {}): string {
  return JSON.stringify({
    ...BASE,
    type: 'assistant',
    timestamp: iso(offsetMs),
    cwd: '/work/proj',
    message: {
      id: options.id ?? `msg_${offsetMs}`,
      role: 'assistant',
      model: options.model ?? 'claude-sonnet-5-5',
      content: blocks,
      stop_reason: options.stopReason ?? null,
      usage: options.usage ?? { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 },
    },
    ...options.extra,
  });
}

export const text = (value: string): unknown => ({ type: 'text', text: value });
export const thinking = (value = ''): unknown => ({ type: 'thinking', thinking: value });
export const toolUse = (id: string, name: string, input: Record<string, unknown>): unknown => ({ type: 'tool_use', id, name, input });

export function jsonl(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

export interface FakeClaudeDir {
  dir: string;
  home: string;
  transcriptPath(sessionId: string, cwd?: string): string;
  writeRegistry(pid: number, entry: Record<string, unknown>): Promise<void>;
  writeTranscript(sessionId: string, content: string, cwd?: string): Promise<string>;
  appendTranscript(sessionId: string, content: string, cwd?: string): Promise<void>;
  writeSubagent(sessionId: string, agentId: string, content: string, meta?: Record<string, unknown>, cwd?: string): Promise<void>;
  cleanup(): Promise<void>;
}

/** A temporary home with `.claude/` holding sessions/ and projects/. */
export async function makeFakeClaude(): Promise<FakeClaudeDir> {
  const home = await makeTempDir('ai-office-home-');
  const dir = join(home, '.claude');
  await mkdir(join(dir, 'sessions'), { recursive: true });
  await mkdir(join(dir, 'projects'), { recursive: true });
  const folder = (cwd: string): string => join(dir, 'projects', encodeProjectDir(cwd));
  const transcriptPath = (sessionId: string, cwd = '/work/proj'): string => join(folder(cwd), `${sessionId}.jsonl`);
  return {
    dir,
    home,
    transcriptPath,
    async writeRegistry(pid, entry) {
      await writeFile(join(dir, 'sessions', `${pid}.json`), JSON.stringify({ pid, cwd: '/work/proj', startedAt: T0 - 60_000, kind: 'interactive', ...entry }));
    },
    async writeTranscript(sessionId, content, cwd = '/work/proj') {
      await mkdir(folder(cwd), { recursive: true });
      const path = transcriptPath(sessionId, cwd);
      await writeFile(path, content);
      return path;
    },
    async appendTranscript(sessionId, content, cwd = '/work/proj') {
      await appendFile(transcriptPath(sessionId, cwd), content);
    },
    async writeSubagent(sessionId, agentId, content, meta, cwd = '/work/proj') {
      const sub = join(folder(cwd), sessionId, 'subagents');
      await mkdir(sub, { recursive: true });
      await writeFile(join(sub, `agent-${agentId}.jsonl`), content);
      if (meta !== undefined) await writeFile(join(sub, `agent-${agentId}.meta.json`), JSON.stringify(meta));
    },
    cleanup: () => removeDir(home),
  };
}
