// Session registry reader: `<dir>/sessions/<pid>.json` files plus pid liveness.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { asNumber, asRecord, asString } from '../util/fs-safe';
import { isSafeSegment } from '../util/ids';

export interface RegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind?: string;
  entrypoint?: string;
  name?: string;
  /** 'busy' | 'idle' | other values written by Claude Code. */
  status?: string;
  updatedAt?: number;
  statusUpdatedAt?: number;
}

export interface RegistrySnapshot {
  /** The sessions directory exists (the Claude Code version writes a registry). */
  supported: boolean;
  /** Entries whose process is alive. */
  open: RegistryEntry[];
}

export type PidCheck = (pid: number) => boolean;

/** Signal-0 liveness check; EPERM means the process exists but belongs to someone else. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function parseRegistryEntry(value: unknown): RegistryEntry | undefined {
  const raw = asRecord(value);
  const pid = asNumber(raw.pid);
  const sessionId = asString(raw.sessionId);
  if (pid === undefined || sessionId === undefined || !isSafeSegment(sessionId)) return undefined;
  const entry: RegistryEntry = {
    pid,
    sessionId,
    cwd: asString(raw.cwd) ?? '',
    startedAt: asNumber(raw.startedAt) ?? 0,
  };
  const optionalStrings = ['kind', 'entrypoint', 'name', 'status'] as const;
  for (const key of optionalStrings) {
    const text = asString(raw[key]);
    if (text !== undefined && text.length > 0) entry[key] = text;
  }
  const updatedAt = asNumber(raw.updatedAt);
  if (updatedAt !== undefined) entry.updatedAt = updatedAt;
  const statusUpdatedAt = asNumber(raw.statusUpdatedAt);
  if (statusUpdatedAt !== undefined) entry.statusUpdatedAt = statusUpdatedAt;
  return entry;
}

export async function readRegistry(dir: string, alive: PidCheck = isPidAlive): Promise<RegistrySnapshot> {
  const sessionsDir = join(dir, 'sessions');
  let names: string[];
  try {
    names = await readdir(sessionsDir);
  } catch {
    return { supported: false, open: [] };
  }
  const open: RegistryEntry[] = [];
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    try {
      const entry = parseRegistryEntry(JSON.parse(await readFile(join(sessionsDir, name), 'utf8')));
      if (entry !== undefined && alive(entry.pid)) open.push(entry);
    } catch {
      // A half-written or corrupt file: skip it, the next scan will see the final content.
    }
  }
  return { supported: true, open };
}
