// Codex rollouts as the transcript files the usage index and the day report read (see usage/discover.ts).
import type { Discovery, TranscriptFile } from '../usage/discover';
import { listRollouts, readRolloutHead } from './rollouts';

/**
 * Every rollout modified at or after `since`. A main session is its own session; a subagent thread belongs to its
 * parent (its thread id is the "agent"); housekeeping threads belong to the thread they served and are flagged internal.
 */
export async function discoverCodexTranscripts(account: string, home: string, since: number): Promise<Discovery> {
  const files: TranscriptFile[] = [];
  for (const file of await listRollouts(home, since)) {
    const head = await readRolloutHead(file);
    const child = head.kind !== 'main';
    files.push({
      account,
      path: file.path,
      rel: file.rel,
      session: child ? (head.parentId ?? head.threadId) : head.threadId,
      agent: child ? head.threadId : '',
      size: file.size,
      mtimeMs: file.mtimeMs,
      ino: file.ino,
      source: 'codex',
      ...(head.kind === 'internal' ? { internal: true } : {}),
      ...(head.kind === 'sub'
        ? {
            meta: {
              ...(head.role !== undefined ? { agentType: head.role } : {}),
              ...(head.nickname !== undefined ? { description: head.nickname } : {}),
            },
          }
        : {}),
    });
  }
  return { files, ok: true };
}
