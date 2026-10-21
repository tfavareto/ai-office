// What a Bash tool call and its result say about the day: the command to show, test runs and their outcome, commits.
import type { ReportTestOutcome } from '@ai-office/shared';

export const COMMAND_MAX = 160;
export const SUBJECT_MAX = 120;

const SECRET_NAME = '(?:token|password|passwd|secret|api[-_]?key|apikey|auth|authorization|credential)s?';
const FLAG_SECRET = new RegExp(`(--?${SECRET_NAME}(?:=|\\s+))(?!-)(\\S+)`, 'gi');
const ENV_SECRET = /\b([A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|CREDENTIAL)[A-Za-z0-9_]*=)(?:"[^"]*"|'[^']*'|\S+)/g;
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const URL_PASSWORD = /(:\/\/[^\s:@/]+:)[^\s@/]+@/g;
const MASK = '***';

/** Hides the values that look like credentials (flags, environment assignments, bearer tokens, URL passwords). */
export function maskSecrets(text: string): string {
  return text
    .replace(ENV_SECRET, `$1${MASK}`)
    .replace(FLAG_SECRET, `$1${MASK}`)
    .replace(BEARER, `$1${MASK}`)
    .replace(URL_PASSWORD, `$1${MASK}@`);
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The command as shown in the report: its first non-empty line, secrets masked, at most {@link COMMAND_MAX} characters. */
export function displayCommand(command: string): string {
  const first = command.split('\n').find((line) => line.trim().length > 0) ?? '';
  return cut(maskSecrets(first.replace(/\s+/g, ' ').trim()), COMMAND_MAX);
}

// ---- test runs --------------------------------------------------------------------------------------------------

const RUNNERS: readonly (readonly [string, RegExp])[] = [
  ['vitest', /\bvitest\b/],
  ['jest', /\bjest\b/],
  ['playwright', /\bplaywright\s+test\b/],
  ['mocha', /\bmocha\b/],
  ['pytest', /\bpy\.?test\b/],
  ['go test', /\bgo\s+test\b/],
  ['cargo test', /\bcargo\s+(?:nextest\s+run|test)\b/],
  ['npm test', /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w:-]+)?(?=\s|$)/],
  ['phpunit', /\bphpunit\b/],
  ['rspec', /\brspec\b/],
  ['mvn test', /\bmvn\s+(?:\S+\s+)*test\b/],
  ['gradle test', /\bgradlew?\s+(?:\S+\s+)*test\b/],
  ['dotnet test', /\bdotnet\s+test\b/],
  ['deno test', /\bdeno\s+test\b/],
  ['mix test', /\bmix\s+test\b/],
  ['swift test', /\bswift\s+test\b/],
  ['node --test', /\bnode\s+(?:\S+\s+)*--test\b/],
];

/** Commands that only mention a runner (searching, printing, versioning) never run it. */
const NOT_A_RUN = new Set(['echo', 'grep', 'rg', 'cat', 'git', 'ls', 'sed', 'head', 'tail', 'find', 'which', 'printf', 'man', 'less', 'diff', 'wc', 'open', 'code', 'vim', 'nano', 'awk']);

const PACKAGE_MANAGEMENT = /^(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|remove|uninstall|info|view)\b/;

/** The test runner a command runs (checked on each piece of a `&&` / `;` / `|` chain), or undefined. */
export function detectTestRunner(command: string): string | undefined {
  for (const piece of command.split(/&&|\|\||;|\||\n/)) {
    const text = piece.trim();
    const first = text.split(/\s+/)[0] ?? '';
    if (text.length === 0 || NOT_A_RUN.has(first) || PACKAGE_MANAGEMENT.test(text)) continue;
    for (const [name, pattern] of RUNNERS) if (pattern.test(text)) return name;
  }
  return undefined;
}

export interface TestOutcome {
  outcome: ReportTestOutcome;
  passed?: number;
  failed?: number;
}

const PASSED_COUNT = /(\d+)\s+passed/gi;
const FAILED_COUNT = /(\d+)\s+failed/gi;
const FAIL_LINE = /^\s*(?:FAIL\b|FAILED\b|--- FAIL|test result: FAILED)/m;
const PASS_LINE = /^\s*(?:ok\s|PASS\b)|test result: ok|^OK\b/m;
const BACKGROUND = /running in (?:the )?background/i;

function lastNumber(pattern: RegExp, text: string): number | undefined {
  let found: number | undefined;
  for (const match of text.matchAll(pattern)) found = Number(match[1]);
  return found;
}

/** Reads a test run's result: counts when the runner prints them, otherwise the exit status and pass/fail markers. */
export function parseTestOutcome(output: string, isError: boolean): TestOutcome {
  const passed = lastNumber(PASSED_COUNT, output);
  const failed = lastNumber(FAILED_COUNT, output);
  const counts = { ...(passed !== undefined ? { passed } : {}), ...(failed !== undefined ? { failed } : {}) };
  if (BACKGROUND.test(output) && !isError) return { outcome: 'unknown' };
  if (isError || (failed !== undefined && failed > 0) || FAIL_LINE.test(output)) return { outcome: 'failed', ...counts };
  if (passed !== undefined || PASS_LINE.test(output)) return { outcome: 'passed', ...counts };
  return { outcome: output.trim().length === 0 ? 'unknown' : 'passed', ...counts };
}

// ---- commits ----------------------------------------------------------------------------------------------------

const COMMIT_COMMAND = /\bgit\b[^|;&\n]*\bcommit(?![\w-])/;
const COMMIT_LINE = /^\[(.+?) ([0-9a-f]{7,40})\] (.+)$/gm;

export function isGitCommit(command: string): boolean {
  return COMMIT_COMMAND.test(command);
}

export interface ParsedCommit {
  hash: string;
  subject: string;
  branch?: string;
}

/** The commits Git reports in the output of `git commit` (`[main abc1234] subject`). */
export function parseCommits(output: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  for (const match of output.matchAll(COMMIT_LINE)) {
    const branch = (match[1] ?? '').split(' ')[0];
    commits.push({ hash: match[2] as string, subject: cut(maskSecrets((match[3] ?? '').trim()), SUBJECT_MAX), ...(branch !== undefined && branch.length > 0 ? { branch } : {}) });
  }
  return commits;
}
