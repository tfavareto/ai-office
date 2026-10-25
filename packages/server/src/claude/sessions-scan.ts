// Recent sessions (last 7 days) from the projects directories, for the history popover.
import { type FileHandle, open } from 'node:fs/promises';
import { type Account, type RecentSession, basename, truncate } from '@ai-office/shared';
import { listRollouts, readRolloutHead } from '../codex/rollouts';
import { readThreadNames } from '../codex/thread-names';
import { codexParser, parseClaudeLine } from '../sources';
import { listMainTranscripts } from './paths';
import type { LineParser } from './types';

export const RECENT_WINDOW_MS = 7 * 24 * 3_600_000;
const HEAD_BYTES = 128 * 1024;
const TAIL_BYTES = 256 * 1024;
const MAX_SESSIONS = 300;

interface Meta {
  firstAt: number;
  projectPath: string | undefined;
  firstPrompt: string | undefined;
  customTitle: string | undefined;
  lastPrompt: string | undefined;
}

const cache = new Map<string, { stamp: string; meta: Meta }>();

async function readRange(handle: FileHandle, position: number, length: number): Promise<string> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.toString('utf8', 0, bytesRead);
}

async function readMeta(path: string, size: number, parse: LineParser): Promise<Meta> {
  const meta: Meta = {
    firstAt: 0,
    projectPath: undefined,
    firstPrompt: undefined,
    customTitle: undefined,
    lastPrompt: undefined,
  };
  const handle = await open(path, 'r');
  try {
    const head = (await readRange(handle, 0, Math.min(size, HEAD_BYTES))).split('\n');
    if (size > HEAD_BYTES) head.pop();
    for (const raw of head) {
      for (const line of parse(raw)) {
        if (!('at' in line)) continue;
        if (meta.firstAt === 0) meta.firstAt = line.at;
        meta.projectPath ??= line.cwd;
        if (line.kind === 'prompt') meta.firstPrompt ??= line.text;
      }
      if (meta.firstPrompt !== undefined && meta.projectPath !== undefined) break;
    }
    const tailStart = Math.max(0, size - TAIL_BYTES);
    const tail = (await readRange(handle, tailStart, size - tailStart)).split('\n');
    if (tailStart > 0) tail.shift();
    for (const raw of tail) {
      for (const line of parse(raw)) {
        if (line.kind === 'title') meta.customTitle = line.title;
        else if (line.kind === 'last-prompt') meta.lastPrompt = line.text;
      }
    }
  } finally {
    await handle.close();
  }
  return meta;
}

/** Scans every account for sessions modified within the window, newest first. `open` marks sessions in the office. */
export async function scanRecentSessions(
  accounts: readonly Account[],
  now: number,
  open: (accountId: string, sessionId: string) => { agentId: string; title?: string } | undefined,
): Promise<RecentSession[]> {
  const sessions: RecentSession[] = [];
  for (const account of accounts) {
    if (account.source === 'codex') {
      sessions.push(...(await scanCodexSessions(account, now, open)));
      continue;
    }
    for (const file of await listMainTranscripts(account.dir, now - RECENT_WINDOW_MS)) {
      const stamp = `${file.mtimeMs}:${file.size}`;
      let entry = cache.get(file.path);
      if (entry?.stamp !== stamp) {
        try {
          entry = { stamp, meta: await readMeta(file.path, file.size, parseClaudeLine) };
        } catch {
          continue;
        }
        cache.set(file.path, entry);
      }
      const { meta } = entry;
      if (meta.firstAt === 0) continue;
      const live = open(account.id, file.sessionId);
      const projectPath = meta.projectPath ?? '';
      const title = live?.title ?? meta.customTitle ?? meta.firstPrompt ?? meta.lastPrompt;
      sessions.push({
        accountId: account.id,
        sessionId: file.sessionId,
        projectPath,
        projectName: basename(projectPath) || file.folder,
        ...(title !== undefined ? { title: truncate(title, 80) } : {}),
        firstAt: meta.firstAt,
        lastAt: Math.round(file.mtimeMs),
        open: live !== undefined,
        ...(live !== undefined ? { agentId: live.agentId } : {}),
      });
    }
  }
  return sessions.sort((a, b) => b.lastAt - a.lastAt).slice(0, MAX_SESSIONS);
}

/** Codex sessions of the window: main threads only (subagents and housekeeping threads are not sessions). */
async function scanCodexSessions(
  account: Account,
  now: number,
  open: (accountId: string, sessionId: string) => { agentId: string; title?: string } | undefined,
): Promise<RecentSession[]> {
  const sessions: RecentSession[] = [];
  const names = await readThreadNames(account.dir);
  for (const file of await listRollouts(account.dir, now - RECENT_WINDOW_MS)) {
    const head = await readRolloutHead(file);
    if (head.kind !== 'main') continue;
    const stamp = `${file.mtimeMs}:${file.size}`;
    let entry = cache.get(file.path);
    if (entry?.stamp !== stamp) {
      try {
        entry = { stamp, meta: await readMeta(file.path, file.size, codexParser()) };
      } catch {
        continue;
      }
      cache.set(file.path, entry);
    }
    const { meta } = entry;
    const firstAt = meta.firstAt > 0 ? meta.firstAt : (head.startedAt ?? 0);
    if (firstAt === 0) continue;
    const live = open(account.id, head.threadId);
    const projectPath = meta.projectPath ?? head.cwd ?? '';
    const title = live?.title ?? names.get(head.threadId) ?? meta.firstPrompt;
    sessions.push({
      accountId: account.id,
      sessionId: head.threadId,
      projectPath,
      projectName: basename(projectPath) || head.threadId,
      ...(title !== undefined ? { title: truncate(title, 80) } : {}),
      firstAt,
      lastAt: Math.round(file.mtimeMs),
      open: live !== undefined,
      ...(live !== undefined ? { agentId: live.agentId } : {}),
    });
  }
  return sessions;
}
