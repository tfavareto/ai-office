import { describe, expect, it } from 'vitest';
import { RULES_SCHEMA_VERSION, parseLogFile, parseRulesFile, serializeLog, serializeRules } from './stored';
import { rule } from './fixtures';

const stored = (over: Record<string, unknown> = {}) => ({ ...rule({ id: 'r1' }), ...over });

describe('parseRulesFile', () => {
  it('round-trips what it writes', () => {
    const rules = [rule({ id: 'a1', note: 'testes', hits: 3, lastHitAt: 99 }), rule({ id: 'a2', effect: 'deny', matcher: { kind: 'command-prefix', value: 'git push' } })];
    const parsed = parseRulesFile(serializeRules(rules));
    expect(parsed).toMatchObject({ status: 'ok', dropped: 0, disabled: 0 });
    expect(parsed.rules).toEqual(rules);
    expect(serializeRules(rules).version).toBe(RULES_SCHEMA_VERSION);
  });

  it('migrates a bare array written before versions existed', () => {
    const parsed = parseRulesFile([{ id: 'old1', effect: 'deny', tool: 'Bash', matcher: { kind: 'command-prefix', value: 'git push' } }]);
    expect(parsed.status).toBe('migrated');
    expect(parsed.rules).toEqual([{ id: 'old1', effect: 'deny', tool: 'Bash', matcher: { kind: 'command-prefix', value: 'git push' }, scope: {}, enabled: true, createdAt: 0, hits: 0 }]);
  });

  it.each([null, 'text', 42, {}, { version: 1 }, { version: 1, rules: 'x' }])('treats %j as unreadable', (raw) => {
    expect(parseRulesFile(raw)).toMatchObject({ status: 'unreadable', rules: [] });
  });

  it('refuses a file from a newer version instead of guessing', () => {
    expect(parseRulesFile({ version: RULES_SCHEMA_VERSION + 1, rules: [stored()] })).toMatchObject({ status: 'newer-version', rules: [] });
  });

  it('drops what cannot be read and duplicated ids', () => {
    const parsed = parseRulesFile({ version: 1, rules: [stored(), stored(), { id: 'bad id!' }, 'x', stored({ id: 'r2', effect: 'nope' })] });
    expect(parsed.rules.map((item) => item.id)).toEqual(['r1']);
    expect(parsed.dropped).toBe(4);
  });

  it('switches off an allow rule the safety policy refuses, instead of trusting it', () => {
    const parsed = parseRulesFile({ version: 1, rules: [stored({ id: 'wide', tool: 'Bash', matcher: { kind: 'any', value: '' } }), stored({ id: 'push', matcher: { kind: 'command-prefix', value: 'git push' } })] });
    expect(parsed.rules.map((item) => [item.id, item.enabled])).toEqual([
      ['wide', false],
      ['push', false],
    ]);
    expect(parsed.disabled).toBe(2);
  });

  it('sanitizes counters', () => {
    const parsed = parseRulesFile({ version: 1, rules: [stored({ hits: -4, createdAt: 'x', lastHitAt: Infinity })] });
    expect(parsed.rules[0]).toMatchObject({ hits: 0, createdAt: 0 });
    expect(parsed.rules[0]?.lastHitAt).toBeUndefined();
  });
});

describe('parseLogFile', () => {
  const entry = { id: 'e1', at: 5, outcome: 'allow', ruleId: 'r1', effect: 'allow', tool: 'Bash', matcher: { kind: 'command-prefix', value: 'npm test' }, requestTool: 'Bash', subject: 'npm test', agentId: 'a', agentName: 'Ana' };

  it('reads valid entries and skips broken ones', () => {
    const parsed = parseLogFile(serializeLog([entry as never, { ...entry, id: 'e2', outcome: 'ask', blockedBy: 'sudo' } as never]));
    expect(parsed.status).toBe('ok');
    expect(parsed.entries.map((item) => item.id)).toEqual(['e1', 'e2']);
    expect(parseLogFile({ version: 1, entries: [entry, { ...entry, outcome: 'maybe' }, null, { ...entry, id: 'e3', matcher: { kind: 'zzz', value: '' } }] }).entries).toHaveLength(1);
  });

  it('flags unreadable and newer files', () => {
    expect(parseLogFile('x').status).toBe('unreadable');
    expect(parseLogFile({ version: 1 }).status).toBe('unreadable');
    expect(parseLogFile({ version: 99, entries: [] }).status).toBe('newer-version');
  });
});
