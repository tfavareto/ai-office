import { describe, expect, it } from 'vitest';
import type { AutoDecision, RuleDraft } from '@ai-office/shared';
import {
  EMPTY_FILTER,
  draftFromForm,
  filterLog,
  folderName,
  formFromDraft,
  isFormComplete,
  kindsFor,
  rejectionField,
  rejectionMessage,
  sortRules,
  withKind,
  withTool,
} from './rules';

const draft: RuleDraft = { effect: 'allow', tool: 'Bash', matcher: { kind: 'command-prefix', value: 'npm test' }, scope: { projectPath: '/demo/loja' }, enabled: true };

const entry = (over: Partial<AutoDecision> = {}): AutoDecision => ({
  id: 'e1',
  at: 1,
  outcome: 'allow',
  ruleId: 'r1',
  effect: 'allow',
  tool: 'Bash',
  matcher: { kind: 'command-prefix', value: 'npm test' },
  requestTool: 'Bash',
  subject: 'npm test',
  agentId: 'a1',
  agentName: 'Ana',
  ...over,
});

describe('rule form', () => {
  it('round-trips a draft', () => {
    expect(draftFromForm(formFromDraft(draft))).toEqual(draft);
    expect(draftFromForm(formFromDraft({ ...draft, note: ' x ', scope: { accountId: 'acc1' } }))).toMatchObject({ note: 'x', scope: { accountId: 'acc1' } });
  });

  it('drops the project when the rule is for all projects', () => {
    expect(draftFromForm({ ...formFromDraft(draft), onlyProject: false }).scope).toEqual({});
  });

  it('empties the value of an "any" matcher', () => {
    expect(draftFromForm(withKind(formFromDraft(draft), 'any')).matcher).toEqual({ kind: 'any', value: '' });
  });

  it('keeps the matcher when the new tool understands it, and resets it otherwise', () => {
    const form = formFromDraft(draft);
    expect(withTool(form, 'Bash')).toEqual(form);
    expect(withTool(form, 'Edit')).toMatchObject({ tool: 'Edit', kind: 'path-glob', value: '' });
    expect(withTool(form, 'mcp__docs__search')).toMatchObject({ kind: 'any', value: '' });
    expect(kindsFor('WebFetch')).toEqual(['host', 'exact', 'any']);
  });

  it('is complete with a tool and a value, or any', () => {
    expect(isFormComplete(formFromDraft(draft))).toBe(true);
    expect(isFormComplete({ ...formFromDraft(draft), value: ' ' })).toBe(false);
    expect(isFormComplete({ ...formFromDraft(draft), kind: 'any', value: '' })).toBe(true);
    expect(isFormComplete({ ...formFromDraft(draft), tool: '' })).toBe(false);
  });
});

describe('rejectionMessage', () => {
  it.each([
    [{ error: 'matcher-compound' }, 'rules.error.compound'],
    [{ error: 'matcher-too-broad', detail: 'any' }, 'rules.error.broadAny'],
    [{ error: 'matcher-too-broad', detail: 'tool-wildcard' }, 'rules.error.broadTool'],
    [{ error: 'matcher-too-broad', detail: 'path' }, 'rules.error.broadPath'],
    [{ error: 'matcher-too-broad', detail: 'host' }, 'rules.error.broadHost'],
    [{ error: 'duplicate-rule' }, 'rules.error.duplicate'],
    [{ error: 'invalid-effect' }, 'rules.error.invalid'],
  ] as const)('explains %j with %s', (error, key) => {
    expect(rejectionMessage(error).key).toBe(key);
  });

  it('names the danger with the inbox wording when it has one', () => {
    expect(rejectionMessage({ error: 'matcher-dangerous', detail: 'sudo' })).toEqual({ key: 'rules.error.dangerous', reasonKey: 'inbox.risk.sudo' });
    expect(rejectionMessage({ error: 'matcher-dangerous', detail: 'inline-code' }).reasonKey).toBe('rules.danger.inlineCode');
    expect(rejectionMessage({ error: 'matcher-dangerous', detail: 'command' }).reasonKey).toBe('rules.danger.command');
  });

  it('points at the field when the server names one', () => {
    expect(rejectionField({ error: 'matcher-too-broad', field: 'tool' })).toBe('tool');
    expect(rejectionField({ error: 'duplicate-rule' })).toBeNull();
    expect(rejectionField({ error: 'invalid-effect', field: 'effect' })).toBeNull();
  });
});

describe('log filters', () => {
  const entries = [entry(), entry({ id: 'e2', outcome: 'deny', ruleId: 'r2', subject: 'git push', agentName: 'Bruno' }), entry({ id: 'e3', outcome: 'ask', subject: 'sudo ls' })];

  it('filters by outcome, rule and text (subject, agent or tool)', () => {
    expect(filterLog(entries, EMPTY_FILTER)).toHaveLength(3);
    expect(filterLog(entries, { ...EMPTY_FILTER, outcome: 'deny' }).map((e) => e.id)).toEqual(['e2']);
    expect(filterLog(entries, { ...EMPTY_FILTER, ruleId: 'r1' }).map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(filterLog(entries, { ...EMPTY_FILTER, query: ' BRUNO ' }).map((e) => e.id)).toEqual(['e2']);
    expect(filterLog(entries, { ...EMPTY_FILTER, query: 'sudo' }).map((e) => e.id)).toEqual(['e3']);
    expect(filterLog(entries, { outcome: 'allow', query: 'git', ruleId: null })).toEqual([]);
  });
});

describe('helpers', () => {
  it('names a project by its last folder', () => {
    expect(folderName('/demo/loja')).toBe('loja');
    expect(folderName('/')).toBe('/');
  });

  it('lists active rules first, newest first', () => {
    const rule = (id: string, enabled: boolean, createdAt: number) => ({ ...draft, id, enabled, createdAt, hits: 0 });
    expect(sortRules([rule('a', false, 3), rule('b', true, 1), rule('c', true, 2)]).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});
