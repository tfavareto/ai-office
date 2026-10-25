// Turns the command Codex recorded (an argv array or a string) into the text shown to the user.

const SHELLS = new Set(['bash', 'zsh', 'sh', 'fish', 'dash']);
const SHELL_FLAGS = new Set(['-c', '-lc', '-ic', '-lic', '-cl']);
export const MAX_COMMAND_CHARS = 4000;

function quote(arg: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** `["bash","-lc","npm test"]` -> `npm test`; other argv arrays are joined with shell quoting. */
export function commandText(command: unknown): string | undefined {
  if (typeof command === 'string') return command.slice(0, MAX_COMMAND_CHARS);
  if (!Array.isArray(command) || command.length === 0 || !command.every((part) => typeof part === 'string'))
    return undefined;
  const argv = command as string[];
  const [shell, flag, script] = argv;
  if (
    argv.length === 3 &&
    shell !== undefined &&
    flag !== undefined &&
    script !== undefined &&
    SHELLS.has(baseName(shell)) &&
    SHELL_FLAGS.has(flag)
  )
    return script.slice(0, MAX_COMMAND_CHARS);
  return argv.map(quote).join(' ').slice(0, MAX_COMMAND_CHARS);
}
