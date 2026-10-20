// Validation of the project folder a new agent will work in.
import { access, constants, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { HIRE_MAX_PATH, type HireCheckReason } from '@ai-office/shared';
import { hasControlCharacter } from '../util/text';

export type FolderCheck = { ok: true; path: string; realPath: string } | { ok: false; reason: HireCheckReason };

/** `~` and `~/…` mean the home folder (people type them in the path field). */
export function expandHome(input: string, home: string): string {
  if (input === '~') return home;
  return input.startsWith('~/') ? join(home, input.slice(2)) : input;
}

/** Syntax only: an absolute path without control characters, within the size limit. Returns the normalized path. */
export function normalizeFolderInput(input: string, home: string): string | undefined {
  const expanded = expandHome(input.trim(), home);
  if (expanded.length === 0 || expanded.length > HIRE_MAX_PATH || hasControlCharacter(expanded) || !isAbsolute(expanded)) return undefined;
  return resolve(expanded);
}

function reasonOf(error: unknown): HireCheckReason {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EACCES' || code === 'EPERM' ? 'not-readable' : 'not-found';
}

/** The folder exists, is a directory and can be entered and listed. `realPath` has symlinks resolved (what Claude Code sees as its cwd). */
export async function checkFolder(input: string, home: string): Promise<FolderCheck> {
  const path = normalizeFolderInput(input, home);
  if (path === undefined) return { ok: false, reason: 'not-absolute' };
  try {
    if (!(await stat(path)).isDirectory()) return { ok: false, reason: 'not-directory' };
    await access(path, constants.R_OK | constants.X_OK);
    return { ok: true, path, realPath: await realpath(path) };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}
