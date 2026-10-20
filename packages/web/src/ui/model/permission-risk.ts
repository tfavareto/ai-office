// Detects permission requests that deserve a second look: destructive, privileged or hard-to-undo commands.
// The inbox never includes these in bulk approvals and flags them with a warning badge.
import type { PermissionRequest } from '@ai-office/shared';

export type RiskReason = 'delete' | 'sudo' | 'force-push' | 'reset' | 'permissions' | 'pipe-shell' | 'disk' | 'data' | 'sensitive-file';

type RiskInput = Pick<PermissionRequest, 'toolName' | 'input' | 'summary'>;

interface CommandRule {
  reason: RiskReason;
  pattern: RegExp;
}

// Each pattern looks inside a single simple command (`[^;&|]*` never crosses `;`, `&&` or `|`).
const COMMAND_RULES: readonly CommandRule[] = [
  { reason: 'sudo', pattern: /(^|[\s;&|(])(sudo|doas)(\s|$)/i },
  { reason: 'delete', pattern: /\brm\b[^;&|]*\s(-[a-z]*[rf][a-z]*|--recursive|--force)(\s|$)/i },
  { reason: 'delete', pattern: /\bfind\b[^;&|]*\s-(delete|exec\s+rm)\b/i },
  { reason: 'delete', pattern: /\b(shred|unlink)\s/i },
  { reason: 'delete', pattern: /\bgit\s+clean\b[^;&|]*\s-[a-z]*f/i },
  { reason: 'force-push', pattern: /\bgit\s+push\b[^;&|]*(\s--force|\s-[a-z]*f[a-z]*(\s|$)|\s\+[\w/])/i },
  { reason: 'reset', pattern: /\bgit\s+reset\b[^;&|]*--hard/i },
  { reason: 'reset', pattern: /\bgit\s+stash\s+(clear|drop)\b/i },
  { reason: 'reset', pattern: /\bgit\s+branch\b[^;&|]*\s-D\b/ },
  { reason: 'permissions', pattern: /\b(chmod|chown|chgrp)\b[^;&|]*\s(-[a-z]*R[a-z]*|--recursive)(\s|$)/ },
  { reason: 'permissions', pattern: /\bchmod\s+(-\S+\s+)*[0-7]?777\b/ },
  { reason: 'pipe-shell', pattern: /\b(curl|wget|fetch)\b[^|;&]*\|\s*(sudo\s+)?(env\s+)?(ba|z|da|k|c)?sh\b/i },
  { reason: 'pipe-shell', pattern: /\b(curl|wget|fetch)\b[^|;&]*\|\s*(python3?|perl|ruby|node)\b/i },
  { reason: 'pipe-shell', pattern: /\b(ba|z|da)?sh\s+<\(\s*(curl|wget)\b/i },
  { reason: 'pipe-shell', pattern: /\beval\s+\$\(\s*(curl|wget)\b/i },
  { reason: 'disk', pattern: /\bmkfs(\.\w+)?\b/i },
  { reason: 'disk', pattern: /\bdd\s[^;&|]*\bof=/i },
  { reason: 'disk', pattern: /\b(fdisk|parted)\b|\bdiskutil\s+(erase|partition)/i },
  { reason: 'disk', pattern: />\s*\/dev\/(sd|disk|nvme)/i },
  { reason: 'disk', pattern: /:\(\)\s*\{/ },
  { reason: 'data', pattern: /\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b/i },
];

const WRITE_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SENSITIVE_FILE = /(^|\/)(\.env(\.[\w.-]+)?|id_[a-z0-9]+|authorized_keys|\.npmrc|\.netrc|\.zshrc|\.bashrc|\.zprofile|\.bash_profile)$|(^|\/)\.(ssh|aws|gnupg)\/|^\/(etc|usr|bin|sbin|System)\//;

function inputString(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** The shell command of a Bash request ("" for other tools or when the input has none). */
export function commandOf(permission: Pick<PermissionRequest, 'toolName' | 'input'>): string {
  return permission.toolName === 'Bash' ? (inputString(permission.input, 'command') ?? '') : '';
}

/** The file a file tool touches. */
export function filePathOf(permission: Pick<PermissionRequest, 'toolName' | 'input'>): string | undefined {
  return inputString(permission.input, 'file_path') ?? inputString(permission.input, 'notebook_path') ?? inputString(permission.input, 'path');
}

/** Removes quoting that would hide a command from the patterns (`"rm" -rf`, `r\m`) and folds whitespace. */
function flatten(command: string): string {
  return command.replace(/["'`\\]/g, '').replace(/\s+/g, ' ').trim();
}

export function detectRisk(permission: RiskInput): RiskReason | null {
  if (permission.toolName === 'Bash') {
    const command = flatten(commandOf(permission) || permission.summary);
    return COMMAND_RULES.find((rule) => rule.pattern.test(command))?.reason ?? null;
  }
  if (WRITE_TOOLS.has(permission.toolName)) {
    const path = filePathOf(permission);
    if (path !== undefined && SENSITIVE_FILE.test(path)) return 'sensitive-file';
  }
  return null;
}
