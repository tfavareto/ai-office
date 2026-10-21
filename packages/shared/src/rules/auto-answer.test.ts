import { describe, expect, test } from 'vitest';
import { RuleBook } from './rule-book';
import { autoAnswer, describeRule } from './auto-answer';

function book(): RuleBook {
  let ids = 0;
  return new RuleBook({ now: () => 1000, newId: () => `r${++ids}` });
}

const asker = { toolName: 'Bash', input: { command: 'git push origin main' }, summary: 'git push origin main', agentId: 'a1', agentName: 'Ana', projectPath: '/demo/loja' };

describe('autoAnswer', () => {
  test('an allow rule answers with an allow marked as coming from a rule', () => {
    const rules = book();
    rules.create({ effect: 'allow', tool: 'Bash', matcher: { kind: 'command-prefix', value: 'git status' } });
    expect(autoAnswer(rules, { ...asker, input: { command: 'git status' } })).toMatchObject({ effect: 'allow', decision: { behavior: 'allow', auto: 'rule' } });
  });

  test('a deny rule answers with the rule as the reason, in the language it was written in', () => {
    const rules = book();
    rules.create({ effect: 'deny', tool: 'Bash', matcher: { kind: 'command-prefix', value: 'git push' }, locale: 'es' });
    expect(autoAnswer(rules, asker)?.decision).toEqual({ behavior: 'deny', auto: 'rule', message: 'Bash: git push', locale: 'es' });
  });

  test('leaves unmatched requests, and risky ones an allow rule matched, to the user', () => {
    const rules = book();
    expect(autoAnswer(rules, asker)).toBeUndefined();
    rules.replaceRules([{ id: 'w', effect: 'allow', tool: 'Bash', matcher: { kind: 'any', value: '' }, scope: {}, enabled: true, createdAt: 1, hits: 0 }]);
    expect(autoAnswer(rules, { ...asker, input: { command: 'sudo ls' }, summary: 'sudo ls' })).toBeUndefined();
  });
});

describe('describeRule', () => {
  test('prefers the note, then tool and matcher', () => {
    const rule = { id: 'r', effect: 'deny' as const, tool: 'Edit', matcher: { kind: 'path-glob' as const, value: 'src/**' }, scope: {}, enabled: true, createdAt: 1, hits: 0 };
    expect(describeRule(rule)).toBe('Edit: src/**');
    expect(describeRule({ ...rule, note: 'não mexa' })).toBe('não mexa');
    expect(describeRule({ ...rule, tool: 'mcp__x__*', matcher: { kind: 'any', value: '' } })).toBe('mcp__x__*');
  });
});
