// Loads `node-pty`, an optional native dependency: without it the office works as always, and real terminals are off.
import { chmod, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Logger } from '../log';
import type { PtyProcess, PtySpawner } from './service';

interface NodePtyProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: Buffer | string) => void): unknown;
  onExit(listener: (event: { exitCode: number }) => void): unknown;
}

interface NodePty {
  spawn(
    file: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
      encoding: null;
    },
  ): NodePtyProcess;
}

const EXECUTABLE_BITS = 0o111;

/** Some installs unpack node-pty's helper program without the execute bit, and then every start fails. */
export async function ensureHelperExecutable(packageDir: string, platform: string, arch: string): Promise<void> {
  const helper = join(packageDir, 'prebuilds', `${platform}-${arch}`, 'spawn-helper');
  const info = await stat(helper).catch(() => undefined);
  if (info === undefined || (info.mode & EXECUTABLE_BITS) !== 0) return;
  await chmod(helper, info.mode | EXECUTABLE_BITS);
}

function wrap(pty: NodePtyProcess): PtyProcess {
  return {
    pid: pty.pid,
    write: (data) => pty.write(data),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: (signal) => pty.kill(signal),
    onData: (listener) => {
      pty.onData((data) => listener(typeof data === 'string' ? Buffer.from(data) : data));
    },
    onExit: (listener) => {
      pty.onExit((event) => listener(event.exitCode));
    },
  };
}

/** The engine, or null (with a note in the log) when it is not installed or does not load here. */
export async function loadPtySpawner(log: Logger): Promise<PtySpawner | null> {
  try {
    const packageJson = createRequire(import.meta.url).resolve('node-pty/package.json');
    await ensureHelperExecutable(dirname(packageJson), process.platform, process.arch);
    const module = (await import('node-pty')) as unknown as NodePty & { default?: NodePty };
    const nodePty = module.default ?? module;
    return (file, args, name, options) => wrap(nodePty.spawn(file, [...args], { name, encoding: null, ...options }));
  } catch (error) {
    log.debug(`Terminais reais indisponíveis: ${String(error)}`);
    return null;
  }
}
