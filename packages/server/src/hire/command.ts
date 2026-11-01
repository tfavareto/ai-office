// Building the command that starts Claude Code in a new terminal window. Nothing here touches the system: it turns a
// validated request into the text of a small POSIX `sh` launcher script. Every value that is not a literal of this
// module (paths, prompt, messages) goes through `shellQuote`, so no input can end a quoted string or run a command.
import {
  type HireModel,
  type HireRole,
  type HirePermissionMode,
  type Locale,
  msg,
  translateShared,
} from '@ai-office/shared';

export interface LaunchSpec {
  /** Absolute folder the session starts in (already validated to exist). */
  projectPath: string;
  /** Absolute path of the `claude` executable. */
  claudePath: string;
  /** Account config dir to export as CLAUDE_CONFIG_DIR; undefined for the default account (the variable is unset). */
  configDir?: string | undefined;
  /** First prompt, passed to Claude Code as its single positional argument. */
  prompt?: string | undefined;
  model?: HireModel | undefined;
  permissionMode?: HirePermissionMode | undefined;
  /** Added to Claude Code's own system prompt. */
  instructions?: string | undefined;
  /** Language of the texts the launcher prints when it cannot start the session. */
  locale: Locale;
  /** Private directory that holds the launcher (and so the prompt); the script deletes it as its first action. */
  workDir: string;
}

/** Thrown for input that cannot be quoted safely (a NUL byte cannot live in a shell word or in a process argument). */
export class UnquotableError extends Error {}

/** Single-quotes a value for POSIX sh: the only character that needs care inside '…' is the quote itself. */
export function shellQuote(value: string): string {
  if (value.includes('\0')) throw new UnquotableError('NUL byte in a shell argument');
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Arguments for `claude` (without the executable) in the order they are passed: options first, the prompt last. */
export function claudeArguments(
  spec: Pick<LaunchSpec, 'model' | 'permissionMode' | 'prompt' | 'instructions'>,
): string[] {
  const args: string[] = [];
  if (spec.model !== undefined && spec.model !== 'default') args.push('--model', spec.model);
  if (spec.permissionMode !== undefined && spec.permissionMode !== 'default')
    args.push('--permission-mode', spec.permissionMode);
  if (spec.instructions !== undefined && spec.instructions.length > 0)
    args.push('--append-system-prompt', spec.instructions);
  if (spec.prompt !== undefined && spec.prompt.length > 0) {
    // A prompt that starts with a dash must not be read as an option.
    if (spec.prompt.startsWith('-')) args.push('--');
    args.push(spec.prompt);
  }
  return args;
}

/** What an agent in a real terminal is told about reaching the others. */
export function bridgeInstructions(bridgePath: string): string {
  const run = `node ${shellQuote(bridgePath)}`;
  return [
    'You run in a terminal opened by AI Office. The person can connect you to other agents.',
    `To see who is connected to you: ${run} list`,
    `To message one of them: ${run} send "<name>" "<message>". The answer arrives later as a new message starting with "[Message from <name>".`,
    'Message other agents only when the task calls for it, and answer briefly to avoid long back-and-forth.',
  ].join('\n');
}

/** The instructions an agent starts with: its role, then how to reach the others when it runs in a real terminal. */
export function agentInstructions(role: HireRole | undefined, bridgePath: string | undefined): string | undefined {
  const parts = [
    ...(role !== undefined ? [`Your role here is ${role.name}.\n${role.instructions}`] : []),
    ...(bridgePath !== undefined ? [bridgeInstructions(bridgePath)] : []),
  ];
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

/**
 * What a Claude Code session passes to the programs under it, including a token of its own. When the office was started
 * from inside one, a new session inheriting these thinks it is its child and saves no transcript or registry entry.
 */
const SESSION_VARIABLE = /^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW_)/;
/** Inside those, what the person set for every session: the provider, its login and its limits. */
const PERSON_SETTING = /^CLAUDE_CODE_(USE_|OAUTH_TOKEN$|MAX_OUTPUT_TOKENS$|API_KEY_)/;

/** A session may route its own traffic through a proxy on this computer; that belongs to it. A gateway stays. */
function isLoopbackUrl(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** What a real terminal starts with: the person's environment, the account's folder and a modern terminal. */
export function terminalEnvironment(source: NodeJS.ProcessEnv, configDir: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const insideSession = source.CLAUDECODE !== undefined || source.CLAUDE_CODE_SESSION_ID !== undefined;
  const proxied = isLoopbackUrl(source.ANTHROPIC_BASE_URL);
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || name === 'CLAUDE_CONFIG_DIR' || name.startsWith('AI_OFFICE_')) continue;
    if (insideSession && SESSION_VARIABLE.test(name) && !PERSON_SETTING.test(name)) continue;
    if (insideSession && name === 'ANTHROPIC_BASE_URL' && proxied) continue;
    env[name] = value;
  }
  if (configDir !== undefined) env.CLAUDE_CONFIG_DIR = configDir;
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
}

function printLines(...lines: string[]): string {
  return lines.map((line) => `printf '%s\\n' ${shellQuote(line)}`).join('; ');
}

/** The launcher: removes its own directory, enters the project, selects the account and runs Claude Code. */
export function buildLauncherScript(spec: LaunchSpec): string {
  const say = (key: 'hire.launcher.noFolder' | 'hire.launcher.noClaude' | 'hire.launcher.close'): string =>
    translateShared(spec.locale, msg(key));
  const fail = (key: 'hire.launcher.noFolder' | 'hire.launcher.noClaude'): string =>
    `${printLines(say(key), say('hire.launcher.close'))}; read -r _`;
  const account =
    spec.configDir === undefined
      ? 'unset CLAUDE_CONFIG_DIR'
      : `CLAUDE_CONFIG_DIR=${shellQuote(spec.configDir)}; export CLAUDE_CONFIG_DIR`;
  const command = [spec.claudePath, ...claudeArguments(spec)].map(shellQuote).join(' ');
  return [
    '#!/bin/sh',
    '# Generated by AI Office to open one Claude Code session. It deletes itself (and the prompt it carries) when it starts.',
    `rm -rf -- ${shellQuote(spec.workDir)}`,
    `cd -- ${shellQuote(spec.projectPath)} || { ${fail('hire.launcher.noFolder')}; exit 1; }`,
    account,
    command,
    'status=$?',
    `case $status in 126|127) ${fail('hire.launcher.noClaude')} ;; esac`,
    'exit "$status"',
    '',
  ].join('\n');
}
