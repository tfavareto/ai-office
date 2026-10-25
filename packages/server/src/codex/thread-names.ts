// Names Codex gives to its threads: `<home>/session_index.jsonl`, one `{ id, thread_name, updated_at }` per line. Only the
// last part of a big file is read, and only names for ids the office asks about are kept.
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { asRecord, asString } from '../util/fs-safe';

const TAIL_BYTES = 512 * 1024;
const MAX_NAME_CHARS = 120;

/** Reads the index; later lines win over earlier ones for the same id. Missing or damaged files give an empty map. */
export async function readThreadNames(home: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const path = join(home, 'session_index.jsonl');
  let text: string;
  try {
    const size = (await stat(path)).size;
    const handle = await open(path, 'r');
    try {
      const start = Math.max(0, size - TAIL_BYTES);
      const buffer = Buffer.alloc(size - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      text = buffer.toString('utf8', 0, bytesRead);
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
    } finally {
      await handle.close();
    }
  } catch {
    return names;
  }
  for (const row of text.split('\n')) {
    if (row.length === 0 || row.charCodeAt(0) !== 0x7b) continue;
    try {
      const entry = asRecord(JSON.parse(row));
      const id = asString(entry.id);
      const name = asString(entry.thread_name)?.trim();
      if (id !== undefined && name !== undefined && name.length > 0) names.set(id, name.slice(0, MAX_NAME_CHARS));
    } catch {
      // A half-written last line.
    }
  }
  return names;
}
