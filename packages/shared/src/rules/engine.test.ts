import { describe, expect, it } from 'vitest';
import { evaluateRules, wouldAnswer } from './engine';
import { PROJECT, bash, fetchUrl, file, rule } from './fixtures';

const prefix = (value: string) => ({ kind: 'command-prefix' as const, value });

describe('evaluateRules: matching', () => {
  it('answers a request that matches an allow rule', () => {
    const allow = rule();
    expect(evaluateRules([allow], bash('npm test -- --watch'))).toEqual({
      kind: 'decided',
      rule: allow,
      effect: 'allow',
    });
  });

  it('leaves unmatched requests alone', () => {
    expect(evaluateRules([rule()], bash('npm testx')).kind).toBe('none');
    expect(evaluateRules([rule()], bash('npm test; rm -rf /')).kind).toBe('none');
    expect(evaluateRules([rule()], file('Edit', 'src/a.ts')).kind).toBe('none');
    expect(evaluateRules([], bash('npm test')).kind).toBe('none');
  });

  it('ignores disabled rules', () => {
    expect(evaluateRules([rule({ enabled: false })], bash('npm test')).kind).toBe('none');
  });

  it('matches file globs, hosts and MCP prefixes', () => {
    const edits = rule({ tool: 'Edit', matcher: { kind: 'path-glob', value: 'src/**' } });
    const docs = rule({ tool: 'WebFetch', matcher: { kind: 'host', value: '*.stripe.com' } });
    const mcp = rule({ tool: 'mcp__docs__*', matcher: { kind: 'any', value: '' } });
    expect(evaluateRules([edits], file('Edit', `${PROJECT}/src/a/b.ts`)).kind).toBe('decided');
    expect(evaluateRules([edits], file('Edit', `${PROJECT}/lib/b.ts`)).kind).toBe('none');
    expect(evaluateRules([docs], fetchUrl('https://docs.stripe.com/api?x=1')).kind).toBe('decided');
    expect(evaluateRules([docs], fetchUrl('https://stripe.com/api')).kind).toBe('none');
    expect(evaluateRules([docs], fetchUrl('https://docs.stripe.com.evil.example/')).kind).toBe('none');
    expect(evaluateRules([docs], fetchUrl('https://docs.stripe.com@evil.example/')).kind).toBe('none');
    expect(evaluateRules([mcp], { toolName: 'mcp__docs__search', input: {}, summary: 'docs: search' }).kind).toBe(
      'decided',
    );
    expect(evaluateRules([mcp], { toolName: 'mcp__other__search', input: {}, summary: 'x' }).kind).toBe('none');
  });
});

describe('evaluateRules: precedence', () => {
  it('lets a deny rule win over an allow rule', () => {
    const allow = rule({ matcher: prefix('git') });
    const deny = rule({ effect: 'deny', matcher: prefix('git push') });
    expect(evaluateRules([allow, deny], bash('git push origin main'))).toMatchObject({
      kind: 'decided',
      effect: 'deny',
      rule: deny,
    });
  });

  it('makes a deny rule see through chaining', () => {
    const deny = rule({ effect: 'deny', matcher: prefix('git push') });
    expect(evaluateRules([deny], bash('npm test && git push')).kind).toBe('decided');
  });

  it('prefers the rule with the most specific scope', () => {
    const everywhere = rule({ effect: 'deny', matcher: prefix('npm publish') });
    const project = rule({ effect: 'deny', matcher: prefix('npm publish'), scope: { projectPath: PROJECT } });
    const account = rule({ effect: 'deny', matcher: prefix('npm publish'), scope: { accountId: 'acc1' } });
    expect(evaluateRules([everywhere, account, project], bash('npm publish'))).toMatchObject({ rule: project });
    expect(evaluateRules([everywhere, account], bash('npm publish'))).toMatchObject({ rule: account });
  });

  it('prefers the longer prefix and then the oldest rule', () => {
    const short = rule({ matcher: prefix('npm') });
    const long = rule({ matcher: prefix('npm test') });
    expect(evaluateRules([short, long], bash('npm test'))).toMatchObject({ rule: long });
    const first = rule({ matcher: prefix('ls') });
    const second = rule({ matcher: prefix('ls') });
    expect(evaluateRules([second, first], bash('ls'))).toMatchObject({ rule: first });
  });
});

describe('evaluateRules: scope', () => {
  it('only applies a project rule inside that project', () => {
    const scoped = rule({ scope: { projectPath: PROJECT } });
    expect(evaluateRules([scoped], bash('npm test')).kind).toBe('decided');
    expect(evaluateRules([scoped], bash('npm test', { projectPath: '/demo/other' })).kind).toBe('none');
    expect(evaluateRules([scoped], bash('npm test', { projectPath: undefined })).kind).toBe('none');
    expect(evaluateRules([rule({ scope: { projectPath: `${PROJECT}/` } })], bash('npm test')).kind).toBe('decided');
  });

  it('only applies an account rule to that account', () => {
    const scoped = rule({ scope: { accountId: 'acc2' } });
    expect(evaluateRules([scoped], bash('npm test')).kind).toBe('none');
    expect(evaluateRules([scoped], bash('npm test', { accountId: 'acc2' })).kind).toBe('decided');
  });
});

describe('evaluateRules: safety net', () => {
  it.each([
    'rm -rf dist',
    'sudo npm test',
    'git push --force',
    'bash -c "npm test"',
    'node -e process.exit',
    'python3 -c print',
  ])('hands the risky request %s back to the user even when an allow rule matches', (command) => {
    const first = command.split(' ')[0] as string;
    const all = rule({ matcher: prefix(first) });
    expect(evaluateRules([all], bash(command)).kind).toBe('ask');
  });

  it('never auto-allows a write to a secret, but still lets a deny rule answer', () => {
    const allow = rule({ tool: 'Write', matcher: { kind: 'exact', value: `${PROJECT}/.env` } });
    expect(evaluateRules([allow], file('Write', `${PROJECT}/.env`))).toMatchObject({
      kind: 'ask',
      reason: 'sensitive-file',
    });
    const deny = rule({ effect: 'deny', tool: 'Write', matcher: { kind: 'exact', value: `${PROJECT}/.env` } });
    expect(evaluateRules([allow, deny], file('Write', `${PROJECT}/.env`))).toMatchObject({
      kind: 'decided',
      effect: 'deny',
    });
  });

  it('answers a dangerous request with a deny rule', () => {
    const deny = rule({ effect: 'deny', matcher: prefix('rm') });
    expect(evaluateRules([deny], bash('rm -rf dist')).kind).toBe('decided');
  });
});

describe('wouldAnswer', () => {
  it('counts what a rule would answer, leaving out what safety hands back', () => {
    const all = rule({ matcher: prefix('git') });
    expect(wouldAnswer(all, bash('git status'))).toBe(true);
    expect(wouldAnswer(all, bash('git push --force'))).toBe(false);
    expect(wouldAnswer({ ...all, effect: 'deny' }, bash('git push --force'))).toBe(true);
  });
});
