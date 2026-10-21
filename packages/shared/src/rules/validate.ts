// Validation of rules coming from the user (HTTP bodies, rules.json). Structure first, then the safety policy: an
// allow rule is refused when its matcher would also cover a dangerous request (`any` on Bash, `rm`, `sudo`,
// `git push`...) or a compound command.
import { type Locale, isLocale } from '../i18n';
import type { Rule, RuleBlockReason, RuleEffect, RuleMatcher, RuleMatcherKind, RuleScope } from '../model';
import { detectRisk, isSensitivePath } from '../permission-risk';
import { commandTokens, isSimpleCommand } from './command';
import { MAX_PATH_LENGTH, hasParentSegment, isAbsolutePath, normalizePath, pathSegments, staticBase } from './path';
import { FILE_TOOLS, WRITE_TOOLS } from './request';

export const MAX_NOTE_LENGTH = 200;
export const MAX_VALUE_LENGTH = 300;
export const MAX_ID_LENGTH = 300;
const MAX_DOUBLE_STAR = 3;
const MIN_ABSOLUTE_GLOB_DEPTH = 3;

export type RuleField = 'effect' | 'tool' | 'matcher' | 'scope' | 'enabled' | 'note' | 'locale';

/** Why a rule was refused. The web app explains each code in the user's language. */
export type RuleErrorCode =
  | 'invalid-effect'
  | 'invalid-tool'
  | 'invalid-matcher'
  | 'invalid-scope'
  | 'invalid-enabled'
  | 'invalid-note'
  | 'invalid-locale'
  | 'matcher-unsupported'
  | 'matcher-compound'
  | 'matcher-too-broad'
  | 'matcher-dangerous';

/** What made a matcher too broad or dangerous (`detail` of the error). */
export type RuleDanger = RuleBlockReason | 'command' | 'any' | 'tool-wildcard' | 'path' | 'host';

export interface RuleError {
  code: RuleErrorCode;
  field: RuleField;
  detail?: RuleDanger;
}

/** A rule before it has an id, counters and a creation time. */
export interface RuleDraft {
  effect: RuleEffect;
  tool: string;
  matcher: RuleMatcher;
  scope: RuleScope;
  enabled: boolean;
  note?: string;
  locale?: Locale;
}

export type RuleCheck = { ok: true; draft: RuleDraft } | { ok: false; error: RuleError };

const TOOL_NAME = /^[A-Za-z][\w.-]{0,79}$/;
const MCP_PREFIX = /^mcp__[\w.-]*\*$/;
const MCP_SERVER_PREFIX = /^mcp__[\w.-]+__[\w.-]*\*$/;
const HOST_NAME = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/;
const LOCALHOST = /^localhost(:\d{1,5})?$/;
/** Characters a prefix for an allow rule may not contain: anything that chains, quotes, expands or redirects. */
const PREFIX_FORBIDDEN = /[;&|<>`$(){}\\'"*?~!#\n\r]/;
export const MATCHER_KINDS: readonly RuleMatcherKind[] = ['command-prefix', 'exact', 'path-glob', 'host', 'any'];
const EFFECTS: readonly RuleEffect[] = ['allow', 'deny'];

/** Tools whose every request is safe to allow without looking at it (they only read and look things up). */
const SAFE_ANY_TOOLS: readonly string[] = ['Read', 'Glob', 'Grep', 'WebSearch', 'TodoWrite'];
/** Matchers each tool understands. */
const KINDS_BY_TOOL: Readonly<Record<string, readonly RuleMatcherKind[]>> = {
  Bash: ['command-prefix', 'exact', 'any'],
  WebFetch: ['host', 'exact', 'any'],
  WebSearch: ['exact', 'any'],
  ...Object.fromEntries(FILE_TOOLS.map((tool) => [tool, ['path-glob', 'exact', 'any'] as readonly RuleMatcherKind[]])),
};

/** The matcher kinds a tool understands (any other tool only has `any`). */
export function matcherKindsFor(tool: string): readonly RuleMatcherKind[] {
  return KINDS_BY_TOOL[tool] ?? ['any'];
}

/**
 * Command words an allow prefix may not start with or extend: the programs and sub-commands that are destructive,
 * privileged or run other commands. A prefix is refused when it is a beginning of one of these (`git` covers
 * `git push`) or begins with one (`git push origin`).
 */
const DANGEROUS_COMMANDS: readonly (readonly string[])[] = [
  ['sudo'], ['doas'], ['su'], ['rm'], ['rmdir'], ['shred'], ['unlink'], ['dd'], ['mkfs'], ['fdisk'], ['parted'], ['diskutil'],
  ['chmod'], ['chown'], ['chgrp'], ['eval'], ['exec'], ['source'], ['.'], ['sh'], ['bash'], ['zsh'], ['dash'], ['ksh'], ['fish'],
  ['xargs'], ['env'], ['nohup'], ['ssh'], ['scp'],
  ['git', 'push'], ['git', 'reset'], ['git', 'clean'], ['git', 'branch', '-D'], ['git', 'stash', 'drop'], ['git', 'stash', 'clear'],
];
/** Added to a prefix to see whether the risk detector flags a command it would start (`find` + `-delete`). */
const RISK_PROBES: readonly string[] = ['-rf /', '--force', '--hard', '-D', '-delete', '-R'];

function fail(code: RuleErrorCode, field: RuleField, detail?: RuleDanger): RuleCheck {
  return { ok: false, error: { code, field, ...(detail !== undefined ? { detail } : {}) } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sharesStart(a: readonly string[], b: readonly string[]): boolean {
  const length = Math.min(a.length, b.length);
  return a.slice(0, length).every((word, index) => word === b[index]);
}

/** Why an allow prefix would also let something dangerous through (null when it would not). */
export function dangerOfPrefix(prefix: string): RuleDanger | null {
  const words = commandTokens(prefix);
  if (DANGEROUS_COMMANDS.some((command) => sharesStart(words, command))) return detectRisk({ toolName: 'Bash', input: { command: prefix }, summary: prefix }) ?? 'command';
  for (const suffix of ['', ...RISK_PROBES]) {
    const command = `${prefix} ${suffix}`.trim();
    const risk = detectRisk({ toolName: 'Bash', input: { command }, summary: command });
    if (risk !== null) return risk;
  }
  return null;
}

function checkEffect(value: unknown): RuleEffect | undefined {
  return typeof value === 'string' && (EFFECTS as readonly string[]).includes(value) ? (value as RuleEffect) : undefined;
}

function toolIsValid(tool: unknown): tool is string {
  return typeof tool === 'string' && (TOOL_NAME.test(tool) || MCP_PREFIX.test(tool));
}

function checkMatcherShape(value: unknown): RuleMatcher | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string' || !(MATCHER_KINDS as readonly string[]).includes(value.kind)) return undefined;
  const kind = value.kind as RuleMatcherKind;
  const text = typeof value.value === 'string' ? value.value.trim() : '';
  if (kind === 'any') return value.value === undefined || text === '' ? { kind, value: '' } : undefined;
  if (text.length === 0 || text.length > MAX_VALUE_LENGTH || /[\n\r\0]/.test(text)) return undefined;
  return { kind, value: kind === 'host' ? text.toLowerCase() : text };
}

function checkScope(value: unknown): RuleScope | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  const scope: RuleScope = {};
  if (value.projectPath !== undefined && value.projectPath !== null) {
    if (typeof value.projectPath !== 'string' || !isAbsolutePath(value.projectPath) || value.projectPath.length > MAX_PATH_LENGTH || /[\0\n\r]/.test(value.projectPath) || hasParentSegment(value.projectPath)) return undefined;
    scope.projectPath = normalizePath(value.projectPath);
  }
  if (value.accountId !== undefined && value.accountId !== null) {
    if (typeof value.accountId !== 'string' || value.accountId.length === 0 || value.accountId.length > MAX_ID_LENGTH) return undefined;
    scope.accountId = value.accountId;
  }
  return scope;
}

// ---- allow policy -----------------------------------------------------------------------------------------------------

function allowGlobProblem(glob: string, tool: string): RuleCheck | undefined {
  if (glob.startsWith('~') || hasParentSegment(glob) || /[[\]{}]/.test(glob) || glob.split('**').length - 1 > MAX_DOUBLE_STAR) return fail('invalid-matcher', 'matcher');
  if (!WRITE_TOOLS.includes(tool)) return undefined;
  const base = staticBase(glob);
  if (isAbsolutePath(glob) && base.length < MIN_ABSOLUTE_GLOB_DEPTH) return fail('matcher-too-broad', 'matcher', 'path');
  const sample = (fill: string): string => `${isAbsolutePath(glob) ? '/' : ''}${pathSegments(glob).map((part) => part.replace(/[*?]+/g, fill)).join('/')}`;
  return isSensitivePath(sample('')) || isSensitivePath(sample('x')) || isSensitivePath(`${isAbsolutePath(glob) ? '/' : ''}${base.join('/')}/`) ? fail('matcher-dangerous', 'matcher', 'sensitive-file') : undefined;
}

function allowHostProblem(host: string): RuleCheck | undefined {
  // `*.com`: after the wildcard there must be a registrable domain, not a bare suffix.
  if (/^\*\.[a-z0-9-]+(:\d{1,5})?$/.test(host)) return fail('matcher-too-broad', 'matcher', 'host');
  return HOST_NAME.test(host) || LOCALHOST.test(host) ? undefined : fail('invalid-matcher', 'matcher');
}

function allowExactProblem(tool: string, command: string): RuleCheck | undefined {
  if (tool !== 'Bash') return undefined;
  if (!isSimpleCommand(command)) return fail('matcher-compound', 'matcher');
  const risk = detectRisk({ toolName: 'Bash', input: { command }, summary: command });
  return risk === null ? undefined : fail('matcher-dangerous', 'matcher', risk);
}

function allowPrefixProblem(prefix: string): RuleCheck | undefined {
  if (!isSimpleCommand(prefix) || /\$/.test(prefix)) return fail('matcher-compound', 'matcher');
  if (PREFIX_FORBIDDEN.test(prefix)) return fail('invalid-matcher', 'matcher');
  const danger = dangerOfPrefix(prefix);
  return danger === null ? undefined : fail('matcher-dangerous', 'matcher', danger);
}

function allowToolProblem(tool: string, matcher: RuleMatcher): RuleCheck | undefined {
  if (tool.endsWith('*') && !MCP_SERVER_PREFIX.test(tool)) return fail('matcher-too-broad', 'tool', 'tool-wildcard');
  if (matcher.kind === 'any' && !SAFE_ANY_TOOLS.includes(tool) && !(tool.startsWith('mcp__') && !tool.endsWith('*')) && !MCP_SERVER_PREFIX.test(tool)) {
    return fail('matcher-too-broad', 'matcher', 'any');
  }
  return undefined;
}

/** The safety policy for rules that approve things. */
function allowPolicy(tool: string, matcher: RuleMatcher): RuleCheck | undefined {
  const toolProblem = allowToolProblem(tool, matcher);
  if (toolProblem !== undefined) return toolProblem;
  switch (matcher.kind) {
    case 'command-prefix':
      return allowPrefixProblem(matcher.value);
    case 'path-glob':
      return allowGlobProblem(matcher.value, tool);
    case 'host':
      return allowHostProblem(matcher.value);
    case 'exact':
      return allowExactProblem(tool, matcher.value);
    case 'any':
      return undefined;
  }
}

/** Structure shared by both effects: a deny prefix may hold any words, but no empty or oversized ones. */
function denyShapeProblem(matcher: RuleMatcher): RuleCheck | undefined {
  if (matcher.kind === 'path-glob' && (hasParentSegment(matcher.value) || matcher.value.startsWith('~') || matcher.value.split('**').length - 1 > MAX_DOUBLE_STAR)) return fail('invalid-matcher', 'matcher');
  if (matcher.kind === 'host' && !HOST_NAME.test(matcher.value) && !LOCALHOST.test(matcher.value)) return fail('invalid-matcher', 'matcher');
  if (matcher.kind === 'command-prefix' && commandTokens(matcher.value).length === 0) return fail('invalid-matcher', 'matcher');
  return undefined;
}

/**
 * Validates a whole rule definition (create) and normalizes it: trimmed values, lowercase hosts, normalized project
 * path. Allow rules also pass the safety policy (`enforcePolicy: false` only checks the structure: used to read back
 * stored rules, which are then disabled when they fail the policy).
 */
export function checkRuleDraft(raw: unknown, options: { enforcePolicy?: boolean } = {}): RuleCheck {
  if (!isRecord(raw)) return fail('invalid-effect', 'effect');
  const effect = checkEffect(raw.effect);
  if (effect === undefined) return fail('invalid-effect', 'effect');
  if (!toolIsValid(raw.tool)) return fail('invalid-tool', 'tool');
  const tool = raw.tool;
  const matcher = checkMatcherShape(raw.matcher);
  if (matcher === undefined) return fail('invalid-matcher', 'matcher');
  if (!matcherKindsFor(tool).includes(matcher.kind)) return fail('matcher-unsupported', 'matcher');
  const scope = checkScope(raw.scope);
  if (scope === undefined) return fail('invalid-scope', 'scope');
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return fail('invalid-enabled', 'enabled');
  const note = typeof raw.note === 'string' ? raw.note.trim() : undefined;
  if ((raw.note !== undefined && raw.note !== null && typeof raw.note !== 'string') || (note !== undefined && note.length > MAX_NOTE_LENGTH)) return fail('invalid-note', 'note');
  if (raw.locale !== undefined && raw.locale !== null && !isLocale(raw.locale)) return fail('invalid-locale', 'locale');
  const problem = effect === 'allow' && options.enforcePolicy !== false ? allowPolicy(tool, matcher) : denyShapeProblem(matcher);
  if (problem !== undefined) return problem;
  return {
    ok: true,
    draft: {
      effect,
      tool,
      matcher,
      scope,
      enabled: raw.enabled !== false,
      ...(note !== undefined && note.length > 0 ? { note } : {}),
      ...(isLocale(raw.locale) ? { locale: raw.locale } : {}),
    },
  };
}

/** The editable fields of a stored rule, as a draft. */
export function draftOf(rule: Rule): RuleDraft {
  return {
    effect: rule.effect,
    tool: rule.tool,
    matcher: rule.matcher,
    scope: rule.scope,
    enabled: rule.enabled,
    ...(rule.note !== undefined ? { note: rule.note } : {}),
    ...(rule.locale !== undefined ? { locale: rule.locale } : {}),
  };
}

/** Validates a PATCH body: the fields it names replace the rule's, and the result must be a valid rule. */
export function checkRulePatch(rule: Rule, patch: unknown): RuleCheck {
  if (!isRecord(patch)) return fail('invalid-effect', 'effect');
  const merged: Record<string, unknown> = { ...draftOf(rule) };
  for (const key of ['effect', 'tool', 'matcher', 'scope', 'enabled', 'note', 'locale'] as const) {
    if (!(key in patch)) continue;
    if (key === 'note' && patch.note === null) delete merged.note;
    else if (key === 'locale' && patch.locale === null) delete merged.locale;
    else merged[key] = patch[key];
  }
  return checkRuleDraft(merged);
}
