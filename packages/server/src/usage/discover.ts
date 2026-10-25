// Finds the transcript files of an account: main transcripts and subagent transcripts, with their size and mtime.
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentSource } from '@ai-office/shared';
import type { SubagentMeta } from '../claude/paths';
import { discoverCodexTranscripts } from '../codex/transcripts';
import { isSafeSegment } from '../util/ids';

export interface TranscriptFile {
  account: string;
  path: string;
  /** Path relative to the account directory: stable when the directory is moved. */
  rel: string;
  session: string;
  /** Subagent id; "" for a main transcript. */
  agent: string;
  size: number;
  mtimeMs: number;
  ino: number;
  /** The CLI that wrote the file; absent means Claude Code. */
  source?: AgentSource;
  /** Housekeeping thread of the CLI (Codex approval reviews...): its tokens count, it is not work to report. */
  internal?: boolean;
  /** What the file itself says about a subagent (Codex has no `.meta.json` beside it). */
  meta?: SubagentMeta;
}

export interface Discovery {
  files: TranscriptFile[];
  /** The projects folder could be listed (an unreadable one yields no files, which is not the same as no transcripts). */
  ok: boolean;
}

const SUBAGENT_FILE = /^agent-([A-Za-z0-9_-]+)\.jsonl$/;

async function names(dir: string): Promise<string[] | undefined> {
  try {
    return await readdir(dir);
  } catch {
    return undefined;
  }
}

async function describe(
  account: string,
  accountDir: string,
  rel: string,
  session: string,
  agent: string,
): Promise<TranscriptFile | undefined> {
  const path = join(accountDir, rel);
  try {
    const info = await stat(path);
    return info.isFile()
      ? { account, path, rel, session, agent, size: info.size, mtimeMs: info.mtimeMs, ino: info.ino }
      : undefined;
  } catch {
    // Vanished between listing and stat.
    return undefined;
  }
}

async function subagentFiles(
  account: string,
  accountDir: string,
  folder: string,
  session: string,
): Promise<TranscriptFile[]> {
  const list = await names(join(accountDir, 'projects', folder, session, 'subagents'));
  const found: TranscriptFile[] = [];
  for (const name of list ?? []) {
    const agent = SUBAGENT_FILE.exec(name)?.[1];
    if (agent === undefined) continue;
    const file = await describe(
      account,
      accountDir,
      join('projects', folder, session, 'subagents', name),
      session,
      agent,
    );
    if (file !== undefined) found.push(file);
  }
  return found;
}

/** Lists `projects/<folder>/<session>.jsonl` and `projects/<folder>/<session>/subagents/agent-<id>.jsonl`. */
export async function discoverTranscripts(account: string, accountDir: string): Promise<Discovery> {
  const folders = await names(join(accountDir, 'projects'));
  if (folders === undefined) return { files: [], ok: false };
  const files: TranscriptFile[] = [];
  for (const folder of folders) {
    const entries = await names(join(accountDir, 'projects', folder));
    for (const entry of entries ?? []) {
      if (entry.endsWith('.jsonl')) {
        const session = entry.slice(0, -'.jsonl'.length);
        if (!isSafeSegment(session)) continue;
        const file = await describe(account, accountDir, join('projects', folder, entry), session, '');
        if (file !== undefined) files.push(file);
      } else if (isSafeSegment(entry)) {
        files.push(...(await subagentFiles(account, accountDir, folder, entry)));
      }
    }
  }
  return { files, ok: true };
}

/** The transcripts of one account, whichever CLI wrote them. `since` bounds the Codex day folders that are listed. */
export function discoverForAccount(
  account: { id: string; dir: string; source?: AgentSource },
  since: number,
): Promise<Discovery> {
  return account.source === 'codex'
    ? discoverCodexTranscripts(account.id, account.dir, since)
    : discoverTranscripts(account.id, account.dir);
}
