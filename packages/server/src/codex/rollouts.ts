// Locating Codex rollout files: `<home>/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread id>.jsonl`, and reading the
// first record of each (the session_meta) to tell a session from a subagent thread or from housekeeping.
import { type FileHandle, open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { asRecord, asString } from '../util/fs-safe';
import { isSafeSegment } from '../util/ids';

const ROLLOUT = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9A-Za-z-]{8,64})\.jsonl$/;
const HEAD_BYTES = 64 * 1024;
const MAX_HEAD_BYTES = 1024 * 1024;
const MAX_CACHED_HEADS = 4000;
const DAY_MS = 86_400_000;

export interface RolloutFile {
  path: string;
  /** Path relative to the Codex home. */
  rel: string;
  /** The thread id in the file name. */
  threadId: string;
  size: number;
  mtimeMs: number;
  ino: number;
}

/**
 * - main: a session the person works in.
 * - sub: a thread a session spawned (`thread_spawn`); it shows up next to its parent.
 * - internal: housekeeping threads (approval reviews, compaction, memory); they cost tokens but are not work.
 */
export type RolloutKind = 'main' | 'sub' | 'internal';

export interface RolloutHead {
  kind: RolloutKind;
  /** Thread id (the session id for a main session). */
  threadId: string;
  /** Thread the subagent or internal thread belongs to. */
  parentId: string | undefined;
  cwd: string | undefined;
  nickname: string | undefined;
  role: string | undefined;
  startedAt: number | undefined;
}

async function names(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

const isNumber = (name: string, digits: number): boolean => new RegExp(`^\\d{${digits}}$`).test(name);

/** Local midnight of a folder date, to compare with a time. */
function dayStart(year: string, month: string, day: string): number {
  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
}

/**
 * Rollout files in the day folders that can hold something modified at or after `since`, newest folders first. A
 * session is filed under the day it started, so a folder older than `since` by more than a day cannot hold it.
 */
export async function listRollouts(home: string, since: number): Promise<RolloutFile[]> {
  const root = join(home, 'sessions');
  const files: RolloutFile[] = [];
  for (const year of (await names(root)).filter((name) => isNumber(name, 4))) {
    for (const month of (await names(join(root, year))).filter((name) => isNumber(name, 2))) {
      for (const day of (await names(join(root, year, month))).filter((name) => isNumber(name, 2))) {
        if (dayStart(year, month, day) + DAY_MS < since - DAY_MS) continue;
        const dir = join(root, year, month, day);
        for (const name of await names(dir)) {
          const threadId = ROLLOUT.exec(name)?.[1];
          if (threadId === undefined || !isSafeSegment(threadId)) continue;
          const path = join(dir, name);
          try {
            const info = await stat(path);
            if (info.isFile() && info.mtimeMs >= since)
              files.push({
                path,
                rel: join('sessions', year, month, day, name),
                threadId,
                size: info.size,
                mtimeMs: info.mtimeMs,
                ino: info.ino,
              });
          } catch {
            // Vanished between listing and stat.
          }
        }
      }
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** The first line, reading 64 KB at first and up to 1 MB when the line is longer (session_meta can carry long texts). */
async function firstLine(handle: FileHandle): Promise<string | undefined> {
  for (const bytes of [HEAD_BYTES, MAX_HEAD_BYTES]) {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
    if (newline >= 0 || bytesRead < bytes) return buffer.toString('utf8', 0, newline < 0 ? bytesRead : newline);
  }
  return undefined;
}

/** The first line of a rollout (its session_meta), or undefined when the file is missing, empty or the line too long. */
export async function readFirstRecord(path: string): Promise<string | undefined> {
  let handle: FileHandle;
  try {
    handle = await open(path, 'r');
  } catch {
    return undefined;
  }
  try {
    const line = await firstLine(handle);
    return line === undefined || line.length === 0 ? undefined : line;
  } catch {
    return undefined;
  } finally {
    await handle.close();
  }
}

/** The head of a session_meta payload; a subagent source is `{ subagent: "review" | { thread_spawn: {...} } | { other } }`. */
export function classifyMeta(payload: Record<string, unknown>, fallbackId: string): RolloutHead {
  const threadId = asString(payload.id) ?? fallbackId;
  const subagent = asRecord(payload.source).subagent;
  const spawn = asRecord(asRecord(subagent).thread_spawn);
  const isSub = subagent !== undefined;
  const parentId = asString(spawn.parent_thread_id) ?? asString(payload.parent_thread_id);
  const kind: RolloutKind = !isSub ? 'main' : Object.keys(spawn).length > 0 ? 'sub' : 'internal';
  const timestamp = Date.parse(asString(payload.timestamp) ?? '');
  return {
    kind,
    threadId,
    parentId: isSub ? parentId : undefined,
    cwd: asString(payload.cwd),
    nickname: asString(spawn.agent_nickname) ?? asString(payload.agent_nickname),
    role:
      asString(spawn.agent_role) ??
      asString(spawn.agent_type) ??
      asString(payload.agent_role) ??
      asString(payload.agent_type),
    startedAt: Number.isFinite(timestamp) ? timestamp : undefined,
  };
}

const heads = new Map<string, RolloutHead>();

/** The head of a rollout (cached: the first record never changes). A file with no readable session_meta is a main session. */
export async function readRolloutHead(file: Pick<RolloutFile, 'path' | 'threadId'>): Promise<RolloutHead> {
  const known = heads.get(file.path);
  if (known !== undefined) return known;
  const line = await readFirstRecord(file.path);
  let record: Record<string, unknown> = {};
  try {
    record = asRecord(line === undefined ? undefined : JSON.parse(line));
  } catch {
    // Half-written first line: classified as a plain session for now and read again next time.
  }
  if (record.type !== 'session_meta') return classifyMeta({}, file.threadId);
  const head = classifyMeta(asRecord(record.payload), file.threadId);
  heads.set(file.path, head);
  if (heads.size > MAX_CACHED_HEADS) heads.delete(heads.keys().next().value as string);
  return head;
}

/** The rollout of a thread, found by its id in the day folders (for a session that is not being followed). */
export async function findRollout(home: string, threadId: string): Promise<string | undefined> {
  if (!isSafeSegment(threadId)) return undefined;
  const root = join(home, 'sessions');
  for (const year of (await names(root))
    .filter((name) => isNumber(name, 4))
    .sort()
    .reverse()) {
    for (const month of (await names(join(root, year)))
      .filter((name) => isNumber(name, 2))
      .sort()
      .reverse()) {
      for (const day of (await names(join(root, year, month)))
        .filter((name) => isNumber(name, 2))
        .sort()
        .reverse()) {
        const found = (await names(join(root, year, month, day))).find((name) => ROLLOUT.exec(name)?.[1] === threadId);
        if (found !== undefined) return join(root, year, month, day, found);
      }
    }
  }
  return undefined;
}
