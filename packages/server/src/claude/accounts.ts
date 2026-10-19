// Discovery of Claude Code account (config) directories.
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { type Account, accountColor, fnv1a } from '@ai-office/shared';

export interface DiscoverOptions {
  homeDir: string;
  explicitDirs: string[] | undefined;
  /** Value of CLAUDE_CONFIG_DIR, if any. */
  envDir: string | undefined;
}

async function homeCandidates(homeDir: string): Promise<string[]> {
  try {
    const entries = await readdir(homeDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\.claude(-.+)?$/.test(entry.name))
      .map((entry) => join(homeDir, entry.name))
      .filter((dir) => existsSync(join(dir, 'projects')));
  } catch {
    return [];
  }
}

function slug(name: string): string {
  const cleaned = name.replace(/^\./, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'conta';
}

function labelFor(dir: string, homeDir: string): string {
  const name = basename(dir);
  if (dir === join(homeDir, '.claude')) return 'Pessoal';
  const rest = name.replace(/^\.?claude[-_]?/i, '');
  return rest.length > 0 ? rest : name.replace(/^\./, '');
}

/** Builds the Account list from directories (default account first, stable order, stable ids and colors). */
export function accountsFromDirs(dirs: readonly string[], homeDir: string): Account[] {
  const unique = [...new Set(dirs)];
  const defaultDir = join(homeDir, '.claude');
  unique.sort((a, b) => (a === defaultDir ? -1 : b === defaultDir ? 1 : a.localeCompare(b)));
  const usedIds = new Set<string>();
  return unique.map((dir, index): Account => {
    let id = slug(basename(dir));
    if (usedIds.has(id)) id = `${id}-${(fnv1a(dir) % 0xffff).toString(16)}`;
    usedIds.add(id);
    const label = labelFor(dir, homeDir);
    return { id, label, initial: (label[0] ?? '?').toUpperCase(), color: accountColor(index), dir };
  });
}

export async function discoverAccounts(options: DiscoverOptions): Promise<Account[]> {
  if (options.explicitDirs !== undefined) return accountsFromDirs(options.explicitDirs, options.homeDir);
  const dirs = await homeCandidates(options.homeDir);
  if (options.envDir !== undefined && options.envDir.length > 0 && existsSync(options.envDir)) dirs.push(options.envDir);
  return accountsFromDirs(dirs, options.homeDir);
}
