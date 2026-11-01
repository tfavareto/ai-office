// The files of a project, for the "@file" mention of the Pro view's prompt: names only, never contents. Asks git, so
// ignored files (build output, dependencies, secrets in .gitignore) are never offered.
import { BASE_ARGS } from './read-state';
import { GIT_TIMEOUT_MS, RunError, type Runner } from './run';

/** Paths sent to the page at most: the page filters them on every key press. */
export const MAX_PROJECT_FILES = 5000;

const OUTPUT_TOO_LARGE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

export interface ProjectFileList {
  files: string[];
  truncated: boolean;
}

export function parseFileList(output: string): ProjectFileList {
  const paths = [...new Set(output.split('\0').filter((path) => path.length > 0))].sort();
  return { files: paths.slice(0, MAX_PROJECT_FILES), truncated: paths.length > MAX_PROJECT_FILES };
}

/** A folder that is not a repository, or where git cannot run, simply has nothing to offer. */
export async function listProjectFiles(run: Runner, cwd: string): Promise<ProjectFileList> {
  try {
    const args = [...BASE_ARGS, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'];
    return parseFileList(await run('git', args, { cwd, timeoutMs: GIT_TIMEOUT_MS }));
  } catch (error) {
    const tooLarge = error instanceof RunError && error.code === OUTPUT_TOO_LARGE;
    return { files: [], truncated: tooLarge };
  }
}
