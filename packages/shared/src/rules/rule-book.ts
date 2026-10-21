// The rule book: the rules, the auto-decision log and the requests seen today, in memory. The server persists it, the
// client-side `?mock=1` office uses it as it is. Every change returns a new state (rules are never mutated).
import type { AutoDecision, Rule, RuleBlockReason, RuleEffect } from '../model';
import { evaluateRules, wouldAnswer } from './engine';
import { type RuleError, checkRuleDraft, checkRulePatch } from './validate';
import { type RuleRequest, compactRequest, subjectOf } from './request';

export const MAX_RULES = 200;
export const MAX_LOG_ENTRIES = 500;
export const MAX_HISTORY = 500;

export type RuleBookErrorCode = 'too-many-rules' | 'duplicate-rule' | 'not-found';
export type RuleBookError = RuleError | { code: RuleBookErrorCode; field?: undefined; detail?: undefined };
export type RuleResult<T> = { ok: true; value: T } | { ok: false; error: RuleBookError };

/** A request to decide, plus who asks. */
export interface RuleDecisionRequest extends RuleRequest {
  agentId: string;
  agentName: string;
  demo?: boolean;
}

export type RuleDecision =
  | { kind: 'none' }
  | { kind: RuleEffect; rule: Rule; entry: AutoDecision }
  /** An allow rule matched a risky request; it goes to the user. */
  | { kind: 'ask'; rule: Rule; entry: AutoDecision };

export interface RulePreview {
  /** Requests of the day the rule would have answered. */
  matches: number;
  /** Requests seen today. */
  total: number;
  /** Start of the window (local midnight). */
  since: number;
}

export interface RuleBookOptions {
  now: () => number;
  newId: () => string;
  /** Called after the rules, hit counters or the log changed. */
  onChange?: (what: 'rules' | 'log') => void;
}

interface Seen {
  at: number;
  request: RuleRequest;
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function sameDefinition(a: Rule, b: Rule): boolean {
  return (
    a.effect === b.effect &&
    a.tool === b.tool &&
    a.matcher.kind === b.matcher.kind &&
    a.matcher.value === b.matcher.value &&
    a.scope.projectPath === b.scope.projectPath &&
    a.scope.accountId === b.scope.accountId
  );
}

export class RuleBook {
  private rulesList: readonly Rule[];
  private entries: readonly AutoDecision[];
  private seen: readonly Seen[] = [];

  constructor(
    private readonly options: RuleBookOptions,
    initial: { rules?: readonly Rule[]; log?: readonly AutoDecision[] } = {},
  ) {
    this.rulesList = initial.rules ?? [];
    this.entries = (initial.log ?? []).slice(-MAX_LOG_ENTRIES);
  }

  rules(): readonly Rule[] {
    return this.rulesList;
  }

  /** Replaces all rules (loading from disk, or undoing a change that could not be saved). */
  replaceRules(rules: readonly Rule[]): void {
    this.rulesList = rules;
    this.options.onChange?.('rules');
  }

  replaceLog(entries: readonly AutoDecision[]): void {
    this.entries = entries.slice(-MAX_LOG_ENTRIES);
    this.options.onChange?.('log');
  }

  create(raw: unknown): RuleResult<Rule> {
    const checked = checkRuleDraft(raw);
    if (!checked.ok) return checked;
    if (this.rulesList.length >= MAX_RULES) return { ok: false, error: { code: 'too-many-rules' } };
    const rule: Rule = { ...checked.draft, id: this.options.newId(), createdAt: this.options.now(), hits: 0 };
    if (this.rulesList.some((existing) => sameDefinition(existing, rule)))
      return { ok: false, error: { code: 'duplicate-rule' } };
    this.rulesList = [...this.rulesList, rule];
    this.options.onChange?.('rules');
    return { ok: true, value: rule };
  }

  update(id: string, patch: unknown): RuleResult<Rule> {
    const current = this.rulesList.find((rule) => rule.id === id);
    if (current === undefined) return { ok: false, error: { code: 'not-found' } };
    const checked = checkRulePatch(current, patch);
    if (!checked.ok) return checked;
    const next: Rule = {
      ...checked.draft,
      id: current.id,
      createdAt: current.createdAt,
      hits: current.hits,
      ...(current.lastHitAt !== undefined ? { lastHitAt: current.lastHitAt } : {}),
    };
    if (this.rulesList.some((existing) => existing.id !== id && sameDefinition(existing, next)))
      return { ok: false, error: { code: 'duplicate-rule' } };
    this.rulesList = this.rulesList.map((rule) => (rule.id === id ? next : rule));
    this.options.onChange?.('rules');
    return { ok: true, value: next };
  }

  remove(id: string): boolean {
    if (!this.rulesList.some((rule) => rule.id === id)) return false;
    this.rulesList = this.rulesList.filter((rule) => rule.id !== id);
    this.options.onChange?.('rules');
    return true;
  }

  /** The log, newest first. */
  log(limit = MAX_LOG_ENTRIES): AutoDecision[] {
    return this.entries.slice(-limit).reverse();
  }

  clearLog(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.options.onChange?.('log');
  }

  /**
   * Evaluates a request against the rules. A decision bumps the rule's counter and is logged; an allow rule that
   * matched a risky request is only logged. Every request is remembered for today's previews.
   */
  decide(request: RuleDecisionRequest): RuleDecision {
    const now = this.options.now();
    this.remember(now, request);
    const verdict = evaluateRules(this.rulesList, request);
    if (verdict.kind === 'none') return verdict;
    if (verdict.kind === 'ask')
      return { kind: 'ask', rule: verdict.rule, entry: this.record(now, request, verdict.rule, 'ask', verdict.reason) };
    const rule = this.countHit(verdict.rule, now);
    return { kind: verdict.effect, rule, entry: this.record(now, request, rule, verdict.effect) };
  }

  /** How many of today's requests a rule definition would have answered. */
  preview(raw: unknown): RuleResult<RulePreview> {
    const checked = checkRuleDraft(raw);
    if (!checked.ok) return checked;
    const since = startOfDay(this.options.now());
    const today = this.seen.filter((item) => item.at >= since);
    return {
      ok: true,
      value: {
        matches: today.filter((item) => wouldAnswer(checked.draft, item.request)).length,
        total: today.length,
        since,
      },
    };
  }

  private remember(at: number, request: RuleRequest): void {
    this.seen = [...this.seen, { at, request: compactRequest(request) }].slice(-MAX_HISTORY);
  }

  private countHit(rule: Rule, at: number): Rule {
    const next: Rule = { ...rule, hits: rule.hits + 1, lastHitAt: at };
    this.rulesList = this.rulesList.map((candidate) => (candidate.id === rule.id ? next : candidate));
    this.options.onChange?.('rules');
    return next;
  }

  private record(
    at: number,
    request: RuleDecisionRequest,
    rule: Rule,
    outcome: AutoDecision['outcome'],
    blockedBy?: RuleBlockReason,
  ): AutoDecision {
    const entry: AutoDecision = {
      id: this.options.newId(),
      at,
      outcome,
      ruleId: rule.id,
      effect: rule.effect,
      tool: rule.tool,
      matcher: rule.matcher,
      requestTool: request.toolName,
      subject: subjectOf(request),
      agentId: request.agentId,
      agentName: request.agentName,
      ...(request.projectPath !== undefined ? { projectPath: request.projectPath } : {}),
      ...(request.accountId !== undefined ? { accountId: request.accountId } : {}),
      ...(blockedBy !== undefined ? { blockedBy } : {}),
      ...(request.demo === true ? { demo: true } : {}),
    };
    this.entries = [...this.entries, entry].slice(-MAX_LOG_ENTRIES);
    this.options.onChange?.('log');
    return entry;
  }
}
