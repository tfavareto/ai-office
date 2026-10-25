// Discovery of Codex homes: CODEX_HOME (default ~/.codex) plus the folders named in AI_OFFICE_CODEX_DIRS. Each one is an
// account of its own, so the office can filter and total Codex apart from Claude Code.
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Account, CODEX_ACCOUNT_ID, CODEX_COLOR, CODEX_LABEL, fnv1a } from '@ai-office/shared';

export interface CodexDiscoverOptions {
  homeDir: string;
  /** Value of CODEX_HOME, if any. */
  envDir: string | undefined;
  /** Folders from AI_OFFICE_CODEX_DIRS. */
  extraDirs: readonly string[];
}

function slug(name: string): string {
  const cleaned = name
    .replace(/^\./, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'home';
}

/** The folders to look in, without duplicates: the main home first. */
export function codexDirs(options: CodexDiscoverOptions): string[] {
  const main =
    options.envDir !== undefined && options.envDir.length > 0 ? options.envDir : join(options.homeDir, '.codex');
  return [...new Set([main, ...options.extraDirs])];
}

/** Accounts for the Codex homes that exist. The first keeps the id `codex`; the others get `codex-<name>`. */
export function codexAccounts(dirs: readonly string[]): Account[] {
  const used = new Set<string>();
  return dirs
    .filter((dir) => existsSync(dir))
    .map((dir, index): Account => {
      let id = index === 0 ? CODEX_ACCOUNT_ID : `${CODEX_ACCOUNT_ID}-${slug(basename(dir))}`;
      if (used.has(id)) id = `${id}-${(fnv1a(dir) % 0xffff).toString(16)}`;
      used.add(id);
      return {
        id,
        label: index === 0 ? CODEX_LABEL : `${CODEX_LABEL} ${slug(basename(dir))}`,
        initial: 'C',
        color: CODEX_COLOR,
        dir,
        source: 'codex',
      };
    });
}
