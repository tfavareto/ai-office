// The rules engine: given the rules and one permission request, who answers? Deny rules win over allow rules; among
// rules of the same effect the most specific scope wins; disabled rules are ignored; an allow rule never answers a
// risky request (it hands it back to the user).
import type { Rule, RuleBlockReason, RuleEffect } from '../model';
import { allowBlocker, compareSpecificity, ruleApplies } from './match';
import type { RuleRequest } from './request';

export type RuleVerdict =
  | { kind: 'none' }
  | { kind: 'decided'; rule: Rule; effect: RuleEffect }
  /** An allow rule matched, but the request is risky: the user decides. */
  | { kind: 'ask'; rule: Rule; reason: RuleBlockReason };

export function evaluateRules(rules: readonly Rule[], request: RuleRequest): RuleVerdict {
  const matching = rules.filter((rule) => rule.enabled && ruleApplies(rule, request)).sort(compareSpecificity);
  const deny = matching.find((rule) => rule.effect === 'deny');
  if (deny !== undefined) return { kind: 'decided', rule: deny, effect: 'deny' };
  const allow = matching.find((rule) => rule.effect === 'allow');
  if (allow === undefined) return { kind: 'none' };
  const reason = allowBlocker(request);
  return reason === null ? { kind: 'decided', rule: allow, effect: 'allow' } : { kind: 'ask', rule: allow, reason };
}

/** Would this rule have answered the request? (Used to preview a rule against the requests of the day.) */
export function wouldAnswer(rule: Pick<Rule, 'effect' | 'tool' | 'matcher' | 'scope'>, request: RuleRequest): boolean {
  return ruleApplies(rule, request) && (rule.effect === 'deny' || allowBlocker(request) === null);
}
