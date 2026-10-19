// Locating transcripts and subagent files inside a Claude config dir.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { asRecord, asString } from '../util/fs-safe';
import { isSafeSegment } from '../util/ids';

/** Claude Code names project folders after the cwd with every non-alphanumeric character replaced by "-". */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds `<dir>/projects/<project>/<sessionId>.jsonl`. Tries the folder encoded from `cwd` first, then scans the
 * project folders (the session may have changed directory, or the folder name may be truncated).
 */
export async function findTranscript(dir: string, sessionId: string, cwd?: string): Promise<string | undefined> {
  if (!isSafeSegment(sessionId)) return undefined;
  const projects = join(dir, 'projects');
  if (cwd !== undefined && cwd.length > 0) {
    const direct = join(projects, encodeProjectDir(cwd), `${sessionId}.jsonl`);
    if (await exists(direct)) return direct;
  }
  let folders: string[];
  try {
    folders = await readdir(projects);
  } catch {
    return undefined;
  }
  for (const folder of folders) {
    const candidate = join(projects, folder, `${sessionId}.jsonl`);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

export interface SubagentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
}

export interface SubagentFile {
  agentId: string;
  path: string;
  meta: SubagentMeta | undefined;
}

/** `<project>/<session>.jsonl` -> `<project>/<session>/subagents`. */
export function subagentsDir(transcriptPath: string): string {
  return transcriptPath.replace(/\.jsonl$/, '') + '/subagents';
}

export function parseSubagentMeta(value: unknown): SubagentMeta {
  const raw = asRecord(value);
  const meta: SubagentMeta = {};
  const agentType = asString(raw.agentType);
  const description = asString(raw.description);
  const toolUseId = asString(raw.toolUseId);
  if (agentType !== undefined) meta.agentType = agentType;
  if (description !== undefined) meta.description = description;
  if (toolUseId !== undefined) meta.toolUseId = toolUseId;
  return meta;
}

/** Lists `agent-<id>.jsonl` files of a session with their `.meta.json` (undefined while it is not written yet). */
export async function listSubagents(transcriptPath: string): Promise<SubagentFile[]> {
  const dir = subagentsDir(transcriptPath);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files: SubagentFile[] = [];
  for (const name of names) {
    const match = /^agent-([A-Za-z0-9_-]+)\.jsonl$/.exec(name);
    if (match?.[1] === undefined) continue;
    const agentId = match[1];
    let meta: SubagentMeta | undefined;
    try {
      meta = parseSubagentMeta(JSON.parse(await readFile(join(dir, `agent-${agentId}.meta.json`), 'utf8')));
    } catch {
      meta = undefined;
    }
    files.push({ agentId, path: join(dir, name), meta });
  }
  return files;
}

export interface MainTranscript {
  sessionId: string;
  path: string;
  mtimeMs: number;
  size: number;
  /** Encoded project folder name. */
  folder: string;
}

/** Main transcripts (`projects/<folder>/<session>.jsonl`) modified at or after `since`. */
export async function listMainTranscripts(dir: string, since: number): Promise<MainTranscript[]> {
  const result: MainTranscript[] = [];
  const projects = join(dir, 'projects');
  let folders: string[];
  try {
    folders = await readdir(projects);
  } catch {
    return result;
  }
  for (const folder of folders) {
    let names: string[];
    try {
      names = await readdir(join(projects, folder));
    } catch {
      continue;
    }
    for (const name of names) {
      const match = /^(.+)\.jsonl$/.exec(name);
      if (match?.[1] === undefined || !isSafeSegment(match[1])) continue;
      const path = join(projects, folder, name);
      try {
        const info = await stat(path);
        if (info.mtimeMs >= since) result.push({ sessionId: match[1], path, mtimeMs: info.mtimeMs, size: info.size, folder });
      } catch {
        // Vanished between listing and stat.
      }
    }
  }
  return result;
}
