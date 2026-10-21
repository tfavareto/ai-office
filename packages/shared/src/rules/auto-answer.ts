// Turns the verdict of the rule book into the decision the hook (or the demo) receives.
import type { PermissionDecision, Rule, RuleEffect } from '../model';
import type { RuleBook, RuleDecisionRequest } from './rule-book';

export interface AutoAnswer {
  effect: RuleEffect;
  decision: PermissionDecision;
  rule: Rule;
}

/** What the agent reads as the reason of a refusal: the rule's note, or its tool and matcher. */
export function describeRule(rule: Rule): string {
  if (rule.note !== undefined && rule.note.length > 0) return rule.note;
  return rule.matcher.kind === 'any' ? rule.tool : `${rule.tool}: ${rule.matcher.value}`;
}

/** Evaluates the request (counting the hit and logging when a rule answers); undefined leaves it to the user. */
export function autoAnswer(book: RuleBook, request: RuleDecisionRequest): AutoAnswer | undefined {
  const result = book.decide(request);
  if (result.kind === 'allow')
    return { effect: 'allow', rule: result.rule, decision: { behavior: 'allow', auto: 'rule' } };
  if (result.kind !== 'deny') return undefined;
  return {
    effect: 'deny',
    rule: result.rule,
    decision: {
      behavior: 'deny',
      auto: 'rule',
      message: describeRule(result.rule),
      ...(result.rule.locale !== undefined ? { locale: result.rule.locale } : {}),
    },
  };
}
