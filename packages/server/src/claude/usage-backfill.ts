// Background scan of recent transcripts for usage records (reads each file backwards, stopping at the cutoff).
import { type FileHandle, open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageRecord } from './transcript-state';
import { parseLine } from './line-parser';

const CHUNK_BYTES = 4 * 1024 * 1024;

export type UsageSink = (record: UsageRecord) => void;

/** Reads `path` from its end in chunks, feeding usage records newer than `since` to `sink`. */
export async function scanUsageBackwards(path: string, since: number, sink: UsageSink): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await open(path, 'r');
  } catch {
    return;
  }
  try {
    let position = (await handle.stat()).size;
    let carry = '';
    while (position > 0) {
      const length = Math.min(CHUNK_BYTES, position);
      position -= length;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, position);
      const text = buffer.toString('utf8') + carry;
      const lines = text.split('\n');
      carry = position > 0 ? (lines.shift() ?? '') : '';
      if (processLines(lines, since, sink)) return;
    }
  } finally {
    await handle.close();
  }
}

/** Processes lines newest-first. Returns true when a line older than the cutoff was reached. */
function processLines(lines: readonly string[], since: number, sink: UsageSink): boolean {
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i] as string;
    if (!raw.includes('"usage"') || !raw.includes('"type":"assistant"')) continue;
    const line = parseLine(raw);
    if (line?.kind !== 'assistant' || line.usage === undefined) continue;
    if (line.at < since) return true;
    sink({ ...(line.messageId !== undefined ? { messageId: line.messageId } : {}), at: line.at, ...(line.model !== undefined ? { model: line.model } : {}), usage: line.usage });
  }
  return false;
}

/** Transcript files (main and subagent) of a config dir modified at or after `since`. */
export async function listRecentTranscripts(dir: string, since: number): Promise<string[]> {
  const result: string[] = [];
  const projects = join(dir, 'projects');
  let folders: string[];
  try {
    folders = await readdir(projects);
  } catch {
    return result;
  }
  for (const folder of folders) {
    const folderPath = join(projects, folder);
    let entries: string[];
    try {
      entries = await readdir(folderPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(folderPath, entry);
      if (entry.endsWith('.jsonl')) await pushIfRecent(path, since, result);
      else await collectSubagents(join(path, 'subagents'), since, result);
    }
  }
  return result;
}

async function collectSubagents(dir: string, since: number, result: string[]): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) if (name.endsWith('.jsonl')) await pushIfRecent(join(dir, name), since, result);
}

async function pushIfRecent(path: string, since: number, result: string[]): Promise<void> {
  try {
    if ((await stat(path)).mtimeMs >= since) result.push(path);
  } catch {
    // The file vanished between listing and stat.
  }
}
