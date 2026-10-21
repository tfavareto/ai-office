// Texts of the approval rules screens that several components share: why a rule was refused, what a rule says.
import type { Account, AutoDecision, Rule, RuleErrorBody, RuleMatcher, RuleScope } from '@ai-office/shared';
import { t, type TextKey } from '../i18n';
import { accountLabel } from './display';
import { folderName, rejectionMessage } from './model/rules';

/** The explanation, in the current language, of a rule the server refused. */
export function explainRejection(error: RuleErrorBody): string {
  const message = rejectionMessage(error);
  return t(message.key, message.reasonKey === undefined ? undefined : { reason: t(message.reasonKey) });
}

/** "npm test", "src/**", "docs.stripe.com" — or "any request". */
export function matcherValueText(matcher: RuleMatcher): string {
  return matcher.kind === 'any' ? t('rules.matcher.any') : matcher.value;
}

/** Short name of what a rule covers, used where the rule itself is not on screen ("Bash · npm test"). */
export function ruleLabel(rule: Pick<Rule, 'tool' | 'matcher'> | Pick<AutoDecision, 'tool' | 'matcher'>): string {
  return `${rule.tool} · ${matcherValueText(rule.matcher)}`;
}

/** Where a rule applies: its project and account, or "All projects". */
export function scopeText(scope: RuleScope, accounts: readonly Account[]): string {
  const parts: string[] = [scope.projectPath !== undefined ? t('rules.scope.project', { name: folderName(scope.projectPath) }) : t('rules.scope.all')];
  if (scope.accountId !== undefined) {
    const account = accounts.find((candidate) => candidate.id === scope.accountId);
    parts.push(t('rules.scope.account', { name: account !== undefined ? accountLabel(account) : scope.accountId }));
  }
  return parts.join(' · ');
}

export function effectLabel(effect: Rule['effect']): string {
  return t(`rules.effect.${effect}` satisfies TextKey);
}
