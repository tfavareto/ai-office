// Opening a terminal window that runs a launcher script. macOS drives Terminal.app (or iTerm2 when that is the terminal
// the person has running) through `osascript`; Linux tries the usual emulators in order. Every program is started with
// an argument array and no shell, and the only thing that ever reaches a terminal is `/bin/sh <our own script path>`.
import { execFile, spawn } from 'node:child_process';
import { hasControlCharacter } from '../util/text';
import { shellQuote } from './command';
import { type IsExecutable, isExecutableFile } from './claude-path';
import { delimiter, isAbsolute, join } from 'node:path';

export type LaunchErrorCode = 'no-terminal' | 'terminal-failed' | 'unsupported-platform';

export class LaunchError extends Error {
  constructor(
    readonly code: LaunchErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** What the hire service needs from the system: open a window that runs `scriptPath`. Replaced by a fake in tests. */
export interface TerminalLauncher {
  /** Resolves with the name of the terminal that was used; rejects with a LaunchError. */
  open(scriptPath: string): Promise<string>;
}

export interface ProcessRunner {
  /** Runs a program to completion and resolves with its stdout; rejects on a non-zero exit, a spawn error or a timeout. */
  run(command: string, args: readonly string[], timeoutMs: number): Promise<string>;
  /**
   * Starts a program that stays alive (a terminal emulator). Resolves when it exits cleanly or is still running after
   * `graceMs`; rejects when it cannot start or exits with an error within that time.
   */
  startDetached(command: string, args: readonly string[], graceMs: number): Promise<void>;
}

export const systemRunner: ProcessRunner = {
  run: (command, args, timeoutMs) =>
    new Promise((resolve, reject) => {
      execFile(command, [...args], { timeout: timeoutMs, windowsHide: true }, (error, stdout) =>
        error === null ? resolve(stdout) : reject(error),
      );
    }),
  startDetached: (command, args, graceMs) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { detached: true, stdio: 'ignore' });
      const timer = setTimeout(() => {
        child.unref();
        resolve();
      }, graceMs);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`${command} exited with code ${String(code)}`));
      });
    }),
};

// ---- macOS -------------------------------------------------------------------------------------------------------------

const ITERM_BUNDLE = 'com.googlecode.iterm2';
const OSASCRIPT_TIMEOUT_MS = 20_000;
const PROBE_TIMEOUT_MS = 5000;

/** An AppleScript string literal (double quotes). Only our own single-line command ever goes through it. */
export function appleScriptString(value: string): string {
  if (hasControlCharacter(value))
    throw new LaunchError('terminal-failed', 'Control character in an AppleScript string');
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** The command typed into the new window: the interpreter and our script, both quoted. */
export function terminalCommand(scriptPath: string): string {
  return `/bin/sh ${shellQuote(scriptPath)}`;
}

/** `osascript` arguments (one `-e` per line) that open a Terminal.app window; no extra empty window when Terminal was closed. */
export function terminalAppScript(scriptPath: string): string[] {
  const command = appleScriptString(terminalCommand(scriptPath));
  const lines = [
    'set wasRunning to application "Terminal" is running',
    'tell application "Terminal"',
    'if wasRunning then',
    `do script ${command}`,
    'else',
    'activate',
    'repeat 30 times',
    'if (count of windows) > 0 then exit repeat',
    'delay 0.1',
    'end repeat',
    `if (count of windows) > 0 then do script ${command} in front window`,
    `if (count of windows) is 0 then do script ${command}`,
    'end if',
    'activate',
    'end tell',
  ];
  return lines.flatMap((line) => ['-e', line]);
}

/** `osascript` arguments that open an iTerm2 window running the command. */
export function iTermScript(scriptPath: string): string[] {
  const command = appleScriptString(terminalCommand(scriptPath));
  const lines = [
    `tell application id "${ITERM_BUNDLE}"`,
    'activate',
    `create window with default profile command ${command}`,
    'end tell',
  ];
  return lines.flatMap((line) => ['-e', line]);
}

async function isRunning(runner: ProcessRunner, application: string): Promise<boolean> {
  try {
    return (await runner.run('osascript', ['-e', `${application} is running`], PROBE_TIMEOUT_MS)).trim() === 'true';
  } catch {
    return false;
  }
}

/** iTerm2 only when it is running and Terminal.app is not (then it is the terminal the person is using). */
async function useITerm(runner: ProcessRunner): Promise<boolean> {
  if (!(await isRunning(runner, `application id "${ITERM_BUNDLE}"`))) return false;
  return !(await isRunning(runner, 'application "Terminal"'));
}

// ---- Linux -------------------------------------------------------------------------------------------------------------

interface LinuxTerminal {
  command: string;
  /** Arguments that make the emulator run the rest of the command line instead of a shell. */
  runFlag: readonly string[];
}

export const LINUX_TERMINALS: readonly LinuxTerminal[] = [
  { command: 'x-terminal-emulator', runFlag: ['-e'] },
  { command: 'gnome-terminal', runFlag: ['--'] },
  { command: 'konsole', runFlag: ['-e'] },
  { command: 'xfce4-terminal', runFlag: ['-x'] },
  { command: 'xterm', runFlag: ['-e'] },
];

const START_GRACE_MS = 1500;

export function linuxArguments(terminal: LinuxTerminal, scriptPath: string): string[] {
  return [...terminal.runFlag, '/bin/sh', scriptPath];
}

function findOnPath(command: string, env: NodeJS.ProcessEnv, isExecutable: IsExecutable): string | undefined {
  return (env.PATH ?? '')
    .split(delimiter)
    .filter((dir) => dir !== '' && isAbsolute(dir))
    .map((dir) => join(dir, command))
    .find((candidate) => isExecutable(candidate));
}

export interface SystemLauncherDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  isExecutable?: IsExecutable;
}

/** Opens real terminal windows. Never constructed in tests. */
export class SystemTerminalLauncher implements TerminalLauncher {
  private readonly runner: ProcessRunner;
  private readonly isExecutable: IsExecutable;

  constructor(private readonly deps: SystemLauncherDeps) {
    this.runner = deps.runner ?? systemRunner;
    this.isExecutable = deps.isExecutable ?? isExecutableFile;
  }

  async open(scriptPath: string): Promise<string> {
    if (this.deps.platform === 'darwin') return this.openOnMac(scriptPath);
    if (this.deps.platform === 'linux') return this.openOnLinux(scriptPath);
    throw new LaunchError('unsupported-platform', `Platform ${this.deps.platform} is not supported`);
  }

  private async openOnMac(scriptPath: string): Promise<string> {
    const iTerm = await useITerm(this.runner);
    try {
      await this.runner.run(
        'osascript',
        iTerm ? iTermScript(scriptPath) : terminalAppScript(scriptPath),
        OSASCRIPT_TIMEOUT_MS,
      );
    } catch (error) {
      throw new LaunchError('terminal-failed', `osascript failed: ${String(error)}`);
    }
    return iTerm ? 'iTerm2' : 'Terminal';
  }

  private async openOnLinux(scriptPath: string): Promise<string> {
    const available = LINUX_TERMINALS.flatMap((terminal) => {
      const found = findOnPath(terminal.command, this.deps.env, this.isExecutable);
      return found === undefined ? [] : [{ terminal, found }];
    });
    if (available.length === 0) throw new LaunchError('no-terminal', 'No terminal emulator found');
    for (const { terminal, found } of available) {
      try {
        await this.runner.startDetached(found, linuxArguments(terminal, scriptPath), START_GRACE_MS);
        return terminal.command;
      } catch {
        // Try the next emulator: this one is installed but could not open a window (for example, no display).
      }
    }
    throw new LaunchError('terminal-failed', 'No terminal emulator could open a window');
  }
}
