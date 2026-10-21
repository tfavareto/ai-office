// Runs `git` and `gh` without a shell: an argument array, a time limit, a bounded output and a small environment.
import { execFile } from 'node:child_process';

export const GIT_TIMEOUT_MS = 3000;
export const GH_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
}

/** A command that did not finish with exit code 0. */
export class RunError extends Error {
  constructor(
    message: string,
    /** `ENOENT` when the program does not exist, the exit code, or undefined (killed). */
    readonly code: string | number | undefined,
    readonly stderr: string,
    readonly timedOut: boolean,
  ) {
    super(message);
    this.name = 'RunError';
  }

  get notFound(): boolean {
    return this.code === 'ENOENT';
  }
}

/** Starts `file` with `args` and resolves with its standard output; rejects with a RunError. */
export type Runner = (file: string, args: readonly string[], options: RunOptions) => Promise<string>;

/**
 * Environment of `git`: only what it needs to find its configuration, and nothing that could open a prompt or a
 * credential helper. Optional locks are off so reading never blocks (or races with) the user's own git commands.
 */
export function gitEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    LC_ALL: 'C',
  };
  for (const name of ['PATH', 'HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'TMPDIR']) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/** Environment of `gh`: the person's own (it may hold GH_TOKEN), without prompts, colors or update checks. */
export function ghEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...source,
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_PAGER: 'cat',
    NO_COLOR: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function runner(environment: NodeJS.ProcessEnv): Runner {
  return (file, args, options) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        file,
        [...args],
        {
          cwd: options.cwd,
          env: environment,
          timeout: options.timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
          killSignal: 'SIGKILL',
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          if (error === null) return resolve(stdout);
          const failure = error as NodeJS.ErrnoException & { killed?: boolean };
          reject(new RunError(failure.message, failure.code, String(stderr).slice(0, 2000), failure.killed === true));
        },
      );
    });
}

export function createGitRunner(source: NodeJS.ProcessEnv = process.env): Runner {
  return runner(gitEnvironment(source));
}

export function createGhRunner(source: NodeJS.ProcessEnv = process.env): Runner {
  return runner(ghEnvironment(source));
}
