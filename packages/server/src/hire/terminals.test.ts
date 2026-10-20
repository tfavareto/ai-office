import { describe, expect, test } from 'vitest';
import {
  LINUX_TERMINALS,
  LaunchError,
  type ProcessRunner,
  SystemTerminalLauncher,
  appleScriptString,
  iTermScript,
  linuxArguments,
  terminalAppScript,
  terminalCommand,
} from './terminals';

const SCRIPT = '/var/folders/x/T/ai-office-hire-AbC123/launch.sh';

interface Call {
  command: string;
  args: readonly string[];
}

/** A runner that records what would have been started and answers like osascript or a terminal emulator would. */
function fakeRunner(options: { running?: readonly string[]; failOsascript?: boolean; failing?: readonly string[] } = {}): { runner: ProcessRunner; runs: Call[]; starts: Call[] } {
  const runs: Call[] = [];
  const starts: Call[] = [];
  const runner: ProcessRunner = {
    run: async (command, args) => {
      runs.push({ command, args });
      const probe = args[1] ?? '';
      if (args.length === 2 && probe.endsWith('is running')) return options.running?.some((name) => probe.includes(name)) === true ? 'true\n' : 'false\n';
      if (options.failOsascript) throw new Error('not authorized');
      return '';
    },
    startDetached: async (command, args) => {
      starts.push({ command, args });
      if (options.failing?.includes(command)) throw new Error('no display');
    },
  };
  return { runner, runs, starts };
}

describe('AppleScript builders', () => {
  test('escape backslashes and quotes in string literals', () => {
    expect(appleScriptString('a "b" \\c')).toBe('"a \\"b\\" \\\\c"');
  });

  test('refuse control characters', () => {
    expect(() => appleScriptString('a\nb')).toThrow(LaunchError);
  });

  test('the typed command is the interpreter and our script path, both quoted', () => {
    expect(terminalCommand(SCRIPT)).toBe(`/bin/sh '${SCRIPT}'`);
    expect(terminalCommand("/tmp/it's here/launch.sh")).toBe(`/bin/sh '/tmp/it'\\''s here/launch.sh'`);
  });

  test('the Terminal.app script runs only our command', () => {
    const args = terminalAppScript(SCRIPT);

    expect(args.filter((_, index) => index % 2 === 0).every((flag) => flag === '-e')).toBe(true);
    expect(args.join('\n')).toContain(`do script "/bin/sh '${SCRIPT}'"`);
  });

  test('the iTerm2 script addresses the app by bundle id and runs only our command', () => {
    const text = iTermScript(SCRIPT).join('\n');

    expect(text).toContain('application id "com.googlecode.iterm2"');
    expect(text).toContain(`create window with default profile command "/bin/sh '${SCRIPT}'"`);
  });
});

describe('SystemTerminalLauncher on macOS', () => {
  test('opens Terminal.app by default', async () => {
    const { runner, runs } = fakeRunner();

    const used = await new SystemTerminalLauncher({ platform: 'darwin', env: {}, runner }).open(SCRIPT);

    expect(used).toBe('Terminal');
    expect(runs.at(-1)?.command).toBe('osascript');
    expect(runs.at(-1)?.args.join('\n')).toContain('tell application "Terminal"');
  });

  test('uses iTerm2 when it is running and Terminal.app is not', async () => {
    const { runner, runs } = fakeRunner({ running: ['com.googlecode.iterm2'] });

    const used = await new SystemTerminalLauncher({ platform: 'darwin', env: {}, runner }).open(SCRIPT);

    expect(used).toBe('iTerm2');
    expect(runs.at(-1)?.args.join('\n')).toContain('com.googlecode.iterm2');
  });

  test('keeps Terminal.app when both are running', async () => {
    const { runner } = fakeRunner({ running: ['com.googlecode.iterm2', 'Terminal'] });

    expect(await new SystemTerminalLauncher({ platform: 'darwin', env: {}, runner }).open(SCRIPT)).toBe('Terminal');
  });

  test('reports a failed osascript as terminal-failed', async () => {
    const { runner } = fakeRunner({ failOsascript: true });

    await expect(new SystemTerminalLauncher({ platform: 'darwin', env: {}, runner }).open(SCRIPT)).rejects.toMatchObject({ code: 'terminal-failed' });
  });
});

describe('SystemTerminalLauncher on Linux', () => {
  const env = { PATH: '/usr/bin:/bin' };
  const installed = (...names: string[]) => (path: string): boolean => names.some((name) => path === `/usr/bin/${name}`);

  test('picks the first emulator that is installed and runs the script in it without a shell', async () => {
    const { runner, starts } = fakeRunner();

    const used = await new SystemTerminalLauncher({ platform: 'linux', env, runner, isExecutable: installed('konsole', 'xterm') }).open(SCRIPT);

    expect(used).toBe('konsole');
    expect(starts).toEqual([{ command: '/usr/bin/konsole', args: ['-e', '/bin/sh', SCRIPT] }]);
  });

  test('moves on to the next emulator when one cannot open a window', async () => {
    const { runner, starts } = fakeRunner({ failing: ['/usr/bin/x-terminal-emulator'] });

    const used = await new SystemTerminalLauncher({ platform: 'linux', env, runner, isExecutable: installed('x-terminal-emulator', 'gnome-terminal') }).open(SCRIPT);

    expect(used).toBe('gnome-terminal');
    expect(starts.map((call) => call.command)).toEqual(['/usr/bin/x-terminal-emulator', '/usr/bin/gnome-terminal']);
  });

  test('says there is no terminal when none is installed', async () => {
    const { runner } = fakeRunner();

    await expect(new SystemTerminalLauncher({ platform: 'linux', env, runner, isExecutable: installed() }).open(SCRIPT)).rejects.toMatchObject({ code: 'no-terminal' });
  });

  test('says it failed when every installed emulator fails', async () => {
    const { runner } = fakeRunner({ failing: ['/usr/bin/xterm'] });

    await expect(new SystemTerminalLauncher({ platform: 'linux', env, runner, isExecutable: installed('xterm') }).open(SCRIPT)).rejects.toMatchObject({ code: 'terminal-failed' });
  });

  test('every emulator is told to run `/bin/sh <script>` as the rest of its command line', () => {
    for (const terminal of LINUX_TERMINALS) expect(linuxArguments(terminal, SCRIPT).slice(-2)).toEqual(['/bin/sh', SCRIPT]);
  });
});

describe('SystemTerminalLauncher elsewhere', () => {
  test('is not supported on other platforms', async () => {
    await expect(new SystemTerminalLauncher({ platform: 'win32', env: {}, runner: fakeRunner().runner }).open(SCRIPT)).rejects.toMatchObject({ code: 'unsupported-platform' });
  });
});
