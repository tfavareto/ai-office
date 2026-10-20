// Finds the `claude` executable the way the plugin installer does: the PATH first, then where the native installer
// puts the CLI (often missing from the PATH of programs started outside a shell).
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/** Home-relative locations of the native installer's `claude`, in order of preference. */
const FALLBACKS = ['.local/bin/claude', '.claude/local/claude'] as const;

export type IsExecutable = (path: string) => boolean;

export const isExecutableFile: IsExecutable = (path) => {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export interface ClaudeLookup {
  env: NodeJS.ProcessEnv;
  home: string;
  isExecutable?: IsExecutable;
}

/** Absolute path of an executable `claude`, or undefined when there is none. */
export function resolveClaudeExecutable({ env, home, isExecutable = isExecutableFile }: ClaudeLookup): string | undefined {
  const onPath = (env.PATH ?? '')
    .split(delimiter)
    .filter((dir) => dir !== '' && isAbsolute(dir))
    .map((dir) => join(dir, 'claude'))
    .find((candidate) => isExecutable(candidate));
  if (onPath !== undefined) return onPath;
  return FALLBACKS.map((relative) => join(home, relative)).find((candidate) => isExecutable(candidate));
}
