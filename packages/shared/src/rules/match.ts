// Does a rule apply to a request? Tool, scope and matcher; plus the safety net that keeps allow rules from answering
// risky requests. The allow side is strict (simple commands only), the deny side looks through chaining.
import type { Rule, RuleBlockReason, RuleMatcher, RuleScope } from '../model';
import { detectRisk } from '../permission-risk';
import { foldCommand, isSimpleCommand, matchesPrefixAnywhere, matchesPrefixStrict } from './command';
import { globMatches, normalizePath, resolvePath } from './path';
import { type RuleRequest, commandOfRequest, hostOfUrl, pathOfRequest, queryOfRequest, urlOfRequest } from './request';

/** Inline code runners: `bash -c '…'`, `node -e '…'`, `python -c '…'` run anything, whatever the rule says. */
const INLINE_CODE: readonly RegExp[] = [
  /(^|[\s/])((ba|z|da|k)?sh|fish)\s+-[a-z]*c\b/,
  /\b(node|nodejs|deno|bun)\s+(-e|--eval|-p|--print|eval)\b/,
  /\b(python3?|ruby|perl|php)\s+-[a-zA-Z]*[ceErR]\b/,
  /(^|\s)eval\s/,
];

/** `mcp__github__*` style tool patterns end with `*`; any other tool name is compared whole. */
export function toolMatches(pattern: string, toolName: string): boolean {
  return pattern.endsWith('*') ? toolName.startsWith(pattern.slice(0, -1)) : pattern === toolName;
}

function scopePath(path: string): string {
  return normalizePath(path);
}

export function scopeMatches(scope: RuleScope, request: Pick<RuleRequest, 'projectPath' | 'accountId'>): boolean {
  if (scope.projectPath !== undefined && (request.projectPath === undefined || scopePath(scope.projectPath) !== scopePath(request.projectPath))) return false;
  return scope.accountId === undefined || scope.accountId === request.accountId;
}

function hostMatches(pattern: string, url: string): boolean {
  const parsed = hostOfUrl(url);
  if (parsed === undefined) return false;
  const subject = pattern.includes(':') ? parsed.host : parsed.hostname;
  if (!pattern.startsWith('*.')) return subject === pattern;
  const suffix = pattern.slice(1);
  return subject.length > suffix.length && subject.endsWith(suffix);
}

function exactMatches(value: string, request: RuleRequest, strict: boolean): boolean {
  const command = commandOfRequest(request);
  if (command !== undefined) return foldCommand(command) === foldCommand(value) && (!strict || isSimpleCommand(command));
  const path = pathOfRequest(request);
  if (path !== undefined) return path === resolvePath(value, request.projectPath);
  const url = urlOfRequest(request);
  if (url !== undefined) return url.trim() === value.trim();
  const query = queryOfRequest(request);
  return query !== undefined && query.trim() === value.trim();
}

/** `strict` is the allow side: only simple commands can match. */
export function matcherMatches(matcher: RuleMatcher, request: RuleRequest, strict: boolean): boolean {
  switch (matcher.kind) {
    case 'any':
      return true;
    case 'command-prefix': {
      const command = commandOfRequest(request);
      if (command === undefined) return false;
      return strict ? matchesPrefixStrict(command, matcher.value) : matchesPrefixAnywhere(command, matcher.value);
    }
    case 'path-glob': {
      const path = pathOfRequest(request);
      return path !== undefined && globMatches(matcher.value, path, request.projectPath);
    }
    case 'host': {
      const url = urlOfRequest(request);
      return url !== undefined && hostMatches(matcher.value, url);
    }
    case 'exact':
      return exactMatches(matcher.value, request, strict);
  }
}

/** Whether the rule would answer the request (ignoring `enabled` and the safety net). */
export function ruleApplies(rule: Pick<Rule, 'effect' | 'tool' | 'matcher' | 'scope'>, request: RuleRequest): boolean {
  return toolMatches(rule.tool, request.toolName) && scopeMatches(rule.scope, request) && matcherMatches(rule.matcher, request, rule.effect === 'allow');
}

/** Why an allow rule must not answer this request, if anything: it is risky, or it runs inline code. */
export function allowBlocker(request: RuleRequest): RuleBlockReason | null {
  const risk = detectRisk({ toolName: request.toolName, input: request.input, summary: request.summary });
  if (risk !== null) return risk;
  const command = commandOfRequest(request);
  if (command === undefined) return null;
  const plain = command.replace(/["'`\\]/g, '');
  return INLINE_CODE.some((pattern) => pattern.test(plain)) ? 'inline-code' : null;
}

/** Orders matching rules, most specific first: project scope, account scope, matcher, then the oldest. */
function specificity(rule: Rule): number[] {
  const scope = (rule.scope.projectPath !== undefined ? 2 : 0) + (rule.scope.accountId !== undefined ? 1 : 0);
  const matcher = { exact: 4, 'path-glob': 3, 'command-prefix': 3, host: 2, any: 0 }[rule.matcher.kind];
  const detail = rule.matcher.kind === 'any' ? 0 : Math.min(rule.matcher.value.length, 999);
  return [scope, matcher, rule.tool.endsWith('*') ? 0 : 1, detail];
}

export function compareSpecificity(a: Rule, b: Rule): number {
  const left = specificity(a);
  const right = specificity(b);
  for (let i = 0; i < left.length; i++) {
    const diff = (right[i] as number) - (left[i] as number);
    if (diff !== 0) return diff;
  }
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}
