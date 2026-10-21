// Shell command helpers for approval rules: what counts as a simple command, how it splits into words and how a
// "command prefix" is matched. Pure text handling; nothing here runs or expands anything.

/**
 * Characters that chain commands, redirect, substitute or open a subshell. A command holding any of them (even inside
 * quotes: the check is deliberately blind to quoting) is never a "simple command", so an allow rule cannot match it.
 */
const COMPOUND_CHARS = /[;&|<>`\n\r()]|\$\(/;
/** Splits a compound command into the simple commands it chains (also at subshell and substitution openers). */
const SEGMENT_SPLIT = /;|&&|\|\||\||&|\n|\r|`|\$\(|\(|\)/;
/** Programs that only run another command; a deny rule looks through them (`sudo rm`, `env X=1 rm`, `nohup rm`). */
const WRAPPERS: ReadonlySet<string> = new Set(['sudo', 'doas', 'env', 'command', 'time', 'nohup', 'exec', 'nice', 'xargs', 'builtin']);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export const MAX_COMMAND_LENGTH = 4000;

/** Whitespace folded to single spaces, trimmed. */
export function foldCommand(command: string): string {
  return command.replace(/\s+/g, ' ').trim();
}

/** One command, with no chaining, redirection, backticks, `$(`, subshells or line breaks. */
export function isSimpleCommand(command: string): boolean {
  return command.length > 0 && command.length <= MAX_COMMAND_LENGTH && !COMPOUND_CHARS.test(command);
}

/** Words of a command (split on whitespace; quotes are not interpreted). */
export function commandTokens(command: string): string[] {
  return foldCommand(command).split(' ').filter((token) => token.length > 0);
}

/** The simple commands a compound command is made of (a simple command yields itself). */
export function commandSegments(command: string): string[] {
  return command
    .slice(0, MAX_COMMAND_LENGTH)
    .split(SEGMENT_SPLIT)
    .map(foldCommand)
    .filter((segment) => segment.length > 0);
}

/** The words of a segment without the leading `FOO=1` assignments and wrapper programs (`sudo`, `env`...). */
function unwrap(tokens: readonly string[]): string[] {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] as string;
    if (ENV_ASSIGNMENT.test(token)) {
      index++;
    } else if (WRAPPERS.has(token)) {
      index++;
      // Flags of the wrapper (`sudo -E`, `env -i`) are skipped; an option that takes a value is not understood.
      while (tokens[index]?.startsWith('-') === true) index++;
    } else {
      break;
    }
  }
  return tokens.slice(index);
}

function startsWithTokens(tokens: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length > 0 && tokens.length >= prefix.length && prefix.every((word, index) => tokens[index] === word);
}

/**
 * Allow side: the whole command is one simple command whose first words are exactly the prefix words
 * (`npm test` matches `npm test -- --watch`, not `npm testx` and not `npm test; rm -rf /`).
 */
export function matchesPrefixStrict(command: string, prefix: string): boolean {
  return isSimpleCommand(command) && startsWithTokens(commandTokens(command), commandTokens(prefix));
}

/**
 * Deny side: any simple command of a compound one (looking through `sudo`, `env`...) starting with the prefix words
 * matches, so `git push` is refused in `npm test && git push` too.
 */
export function matchesPrefixAnywhere(command: string, prefix: string): boolean {
  const words = commandTokens(prefix);
  return commandSegments(command).some((segment) => startsWithTokens(commandTokens(segment), words) || startsWithTokens(unwrap(commandTokens(segment)), words));
}
