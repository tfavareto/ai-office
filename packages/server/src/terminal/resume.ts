// What brings real terminals back after the office restarts. Their programs stop with the server, but their conversations
// live in Claude Code's own session files, so `claude --resume` continues each one. The file only holds which sessions
// were open, and the page never supplies an id: it asks to resume what is in this list.
import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { asRecord, readJsonFile, writeJsonAtomic } from '../util/fs-safe';

export const RESUMABLE_FILE = 'resumable-terminals.json';
const VERSION = 1;
/** At most what stays offered: the oldest go first. */
export const MAX_RESUMABLE = 32;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResumableSession {
  sessionId: string;
  cwd: string;
  role?: string;
  configDir?: string;
  roleInstructions?: string;
}

export function isSessionId(value: string): boolean {
  return SESSION_ID.test(value);
}

export function resumeArguments(sessionId: string, instructions: string | undefined): string[] {
  const prompt = instructions !== undefined && instructions !== '' ? ['--append-system-prompt', instructions] : [];
  return [...prompt, '--resume', sessionId];
}

export function parseResumable(raw: unknown): ResumableSession[] {
  const data = asRecord(raw);
  if (data.version !== VERSION || !Array.isArray(data.sessions)) return [];
  const sessions = data.sessions.flatMap((entry: unknown) => {
    const { sessionId, cwd, role, configDir, roleInstructions } = asRecord(entry);
    if (typeof sessionId !== 'string' || !isSessionId(sessionId)) return [];
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) return [];
    return [
      {
        sessionId,
        cwd,
        ...(typeof role === 'string' ? { role } : {}),
        ...(typeof configDir === 'string' && isAbsolute(configDir) ? { configDir } : {}),
        ...(typeof roleInstructions === 'string' ? { roleInstructions } : {}),
      },
    ];
  });
  return sessions.slice(0, MAX_RESUMABLE);
}

/** What was saved, without the sessions whose folder is gone. */
export async function loadResumable(stateDir: string): Promise<ResumableSession[]> {
  const saved = parseResumable(await readJsonFile(join(stateDir, RESUMABLE_FILE)).catch(() => null));
  const present = await Promise.all(
    saved.map((session) =>
      stat(session.cwd).then(
        (info) => info.isDirectory(),
        () => false,
      ),
    ),
  );
  return saved.filter((_, index) => present[index]);
}

export function saveResumable(stateDir: string, sessions: readonly ResumableSession[]): Promise<void> {
  return writeJsonAtomic(join(stateDir, RESUMABLE_FILE), { version: VERSION, sessions });
}
