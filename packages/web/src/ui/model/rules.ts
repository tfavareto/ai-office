// Pure model of the approval rules screens: the editor form, the explanation of a refused rule, the log filters.
// No DOM and no network: the controller and the components build on it.
import {
  type AutoDecision,
  type AutoDecisionOutcome,
  type Rule,
  type RuleDraft,
  type RuleEffect,
  type RuleErrorBody,
  type RuleMatcher,
  type RuleMatcherKind,
  matcherKindsFor,
} from '@ai-office/shared';
import type { TextKey } from '../../i18n';

/** Tools offered in the editor's list (any other name can be typed, e.g. an MCP tool). */
export const COMMON_TOOLS: readonly string[] = [
  'Bash',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Read',
  'WebFetch',
  'WebSearch',
];

export interface RuleForm {
  effect: RuleEffect;
  tool: string;
  kind: RuleMatcherKind;
  value: string;
  /** Limit the rule to one project (`projectPath`). */
  onlyProject: boolean;
  projectPath: string;
  /** Limit the rule to one account ('' = all). */
  accountId: string;
  note: string;
  enabled: boolean;
}

export function formFromDraft(draft: RuleDraft): RuleForm {
  return {
    effect: draft.effect,
    tool: draft.tool,
    kind: draft.matcher.kind,
    value: draft.matcher.value,
    onlyProject: draft.scope.projectPath !== undefined,
    projectPath: draft.scope.projectPath ?? '',
    accountId: draft.scope.accountId ?? '',
    note: draft.note ?? '',
    enabled: draft.enabled,
  };
}

export function draftFromForm(form: RuleForm): RuleDraft {
  const matcher: RuleMatcher = { kind: form.kind, value: form.kind === 'any' ? '' : form.value.trim() };
  const note = form.note.trim();
  return {
    effect: form.effect,
    tool: form.tool.trim(),
    matcher,
    scope: {
      ...(form.onlyProject && form.projectPath !== '' ? { projectPath: form.projectPath } : {}),
      ...(form.accountId !== '' ? { accountId: form.accountId } : {}),
    },
    enabled: form.enabled,
    ...(note.length > 0 ? { note } : {}),
  };
}

/** A new tool keeps the matcher when the tool understands it; otherwise the first kind it does and an empty value. */
export function withTool(form: RuleForm, tool: string): RuleForm {
  const kinds = matcherKindsFor(tool.trim());
  return kinds.includes(form.kind) ? { ...form, tool } : { ...form, tool, kind: kinds[0] ?? 'any', value: '' };
}

export function withKind(form: RuleForm, kind: RuleMatcherKind): RuleForm {
  return { ...form, kind, value: kind === 'any' ? '' : form.value };
}

export function kindsFor(tool: string): readonly RuleMatcherKind[] {
  return matcherKindsFor(tool.trim());
}

/** Whether the form can be sent: a tool, and a value unless the matcher is `any`. */
export function isFormComplete(form: RuleForm): boolean {
  return form.tool.trim().length > 0 && (form.kind === 'any' || form.value.trim().length > 0);
}

const RISK_DETAILS: readonly string[] = [
  'delete',
  'sudo',
  'force-push',
  'reset',
  'permissions',
  'pipe-shell',
  'disk',
  'data',
  'sensitive-file',
];

/** What made a matcher dangerous, as a text key (`inbox.risk.*` for the risks the inbox already names). */
function dangerKey(detail: string | undefined): TextKey {
  if (detail !== undefined && RISK_DETAILS.includes(detail)) return `inbox.risk.${detail}` as TextKey;
  return detail === 'inline-code' ? 'rules.danger.inlineCode' : 'rules.danger.command';
}

/**
 * The text key that explains why the server refused a rule. `reasonKey`, when present, names the danger and goes in
 * the `{reason}` parameter of the message.
 */
export function rejectionMessage(error: RuleErrorBody): { key: TextKey; reasonKey?: TextKey } {
  switch (error.error) {
    case 'invalid-tool':
      return { key: 'rules.error.invalidTool' };
    case 'invalid-matcher':
      return { key: 'rules.error.invalidMatcher' };
    case 'invalid-scope':
      return { key: 'rules.error.invalidScope' };
    case 'invalid-note':
      return { key: 'rules.error.invalidNote' };
    case 'matcher-unsupported':
      return { key: 'rules.error.unsupported' };
    case 'matcher-compound':
      return { key: 'rules.error.compound' };
    case 'matcher-too-broad':
      return {
        key:
          error.detail === 'tool-wildcard'
            ? 'rules.error.broadTool'
            : error.detail === 'path'
              ? 'rules.error.broadPath'
              : error.detail === 'host'
                ? 'rules.error.broadHost'
                : 'rules.error.broadAny',
      };
    case 'matcher-dangerous':
      return { key: 'rules.error.dangerous', reasonKey: dangerKey(error.detail) };
    case 'duplicate-rule':
      return { key: 'rules.error.duplicate' };
    case 'too-many-rules':
      return { key: 'rules.error.tooMany' };
    case 'not-found':
      return { key: 'rules.error.notFound' };
    default:
      return { key: 'rules.error.invalid' };
  }
}

/** The field a refusal is about, so the editor can focus it. */
export function rejectionField(error: RuleErrorBody): 'tool' | 'matcher' | 'scope' | 'note' | null {
  return error.field === 'tool' || error.field === 'matcher' || error.field === 'scope' || error.field === 'note'
    ? error.field
    : null;
}

export type OutcomeFilter = 'all' | AutoDecisionOutcome;

export interface LogFilter {
  outcome: OutcomeFilter;
  query: string;
  /** Only the entries of this rule. */
  ruleId: string | null;
}

export const EMPTY_FILTER: LogFilter = { outcome: 'all', query: '', ruleId: null };

export function filterLog(entries: readonly AutoDecision[], filter: LogFilter): AutoDecision[] {
  const query = filter.query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter.outcome !== 'all' && entry.outcome !== filter.outcome) return false;
    if (filter.ruleId !== null && entry.ruleId !== filter.ruleId) return false;
    return query === '' || `${entry.subject} ${entry.agentName} ${entry.requestTool}`.toLowerCase().includes(query);
  });
}

/** Last folder of a project path, for compact scope labels. */
export function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

export function sortRules(rules: readonly Rule[]): Rule[] {
  return [...rules].sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.createdAt - a.createdAt);
}
