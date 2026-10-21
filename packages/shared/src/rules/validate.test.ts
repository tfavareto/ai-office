import { describe, expect, it } from 'vitest';
import { checkRuleDraft, checkRulePatch, dangerOfPrefix } from './validate';
import { rule } from './fixtures';

const allow = (tool: string, kind: string, value = '', extra: Record<string, unknown> = {}) => ({
  effect: 'allow',
  tool,
  matcher: { kind, value },
  ...extra,
});
const errorOf = (raw: unknown) => {
  const checked = checkRuleDraft(raw);
  return checked.ok ? undefined : checked.error;
};

describe('checkRuleDraft: structure', () => {
  it('normalizes a valid rule', () => {
    const checked = checkRuleDraft({
      effect: 'allow',
      tool: 'Bash',
      matcher: { kind: 'command-prefix', value: '  npm   test ' },
      scope: { projectPath: '/demo//loja/' },
      note: ' roda os testes ',
      locale: 'en',
    });
    expect(checked).toEqual({
      ok: true,
      draft: {
        effect: 'allow',
        tool: 'Bash',
        matcher: { kind: 'command-prefix', value: 'npm   test' },
        scope: { projectPath: '/demo/loja' },
        enabled: true,
        note: 'roda os testes',
        locale: 'en',
      },
    });
  });

  it.each([
    [{}, 'invalid-effect'],
    [{ effect: 'maybe', tool: 'Bash', matcher: { kind: 'any', value: '' } }, 'invalid-effect'],
    [{ effect: 'deny', tool: 'not a tool!', matcher: { kind: 'any', value: '' } }, 'invalid-tool'],
    [{ effect: 'deny', tool: 'Bash', matcher: { kind: 'regex', value: 'x' } }, 'invalid-matcher'],
    [{ effect: 'deny', tool: 'Bash', matcher: { kind: 'command-prefix', value: '' } }, 'invalid-matcher'],
    [{ effect: 'deny', tool: 'Bash', matcher: { kind: 'host', value: 'a.com' } }, 'matcher-unsupported'],
    [
      { effect: 'deny', tool: 'Bash', matcher: { kind: 'any', value: '' }, scope: { projectPath: 'relative' } },
      'invalid-scope',
    ],
    [
      { effect: 'deny', tool: 'Bash', matcher: { kind: 'any', value: '' }, scope: { projectPath: '/a/../b' } },
      'invalid-scope',
    ],
    [{ effect: 'deny', tool: 'Bash', matcher: { kind: 'any', value: '' }, enabled: 'yes' }, 'invalid-enabled'],
    [{ effect: 'deny', tool: 'Bash', matcher: { kind: 'any', value: '' }, note: 'x'.repeat(201) }, 'invalid-note'],
    [{ effect: 'deny', tool: 'Bash', matcher: { kind: 'any', value: '' }, locale: 'fr' }, 'invalid-locale'],
  ])('refuses %j with %s', (raw, code) => {
    expect(errorOf(raw)?.code).toBe(code);
  });
});

describe('checkRuleDraft: allow rules never cover dangerous requests', () => {
  it.each([
    'rm',
    'rm -rf dist',
    'sudo',
    'sudo npm install',
    'git push',
    'git push origin main',
    'git',
    'git reset',
    'git clean',
    'chmod',
    'bash',
    'env',
    'find',
    'dd',
  ])('refuses the prefix %s', (prefix) => {
    expect(errorOf(allow('Bash', 'command-prefix', prefix))?.code).toBe('matcher-dangerous');
  });

  it.each(['npm test', 'npm run build', 'git status', 'git add', 'git commit', 'ls', 'pnpm install', 'docker ps'])(
    'accepts the prefix %s',
    (prefix) => {
      expect(checkRuleDraft(allow('Bash', 'command-prefix', prefix)).ok).toBe(true);
    },
  );

  it('refuses any on Bash, file tools and wildcards', () => {
    expect(errorOf(allow('Bash', 'any'))).toMatchObject({ code: 'matcher-too-broad', detail: 'any' });
    expect(errorOf(allow('Edit', 'any'))?.code).toBe('matcher-too-broad');
    expect(errorOf(allow('mcp__*', 'any'))).toMatchObject({ code: 'matcher-too-broad', detail: 'tool-wildcard' });
    expect(errorOf(allow('mcp__*', 'any'))?.field).toBe('tool');
  });

  it('accepts any on read-only tools and on one MCP tool or server', () => {
    expect(checkRuleDraft(allow('Read', 'any')).ok).toBe(true);
    expect(checkRuleDraft(allow('mcp__docs__search', 'any')).ok).toBe(true);
    expect(checkRuleDraft(allow('mcp__docs__*', 'any')).ok).toBe(true);
  });

  it('refuses compound and dangerous exact commands', () => {
    expect(errorOf(allow('Bash', 'exact', 'npm test; rm -rf /'))?.code).toBe('matcher-compound');
    expect(errorOf(allow('Bash', 'exact', 'rm -rf dist'))?.code).toBe('matcher-dangerous');
    expect(checkRuleDraft(allow('Bash', 'exact', 'npm test')).ok).toBe(true);
  });

  it('refuses prefixes with shell syntax', () => {
    expect(errorOf(allow('Bash', 'command-prefix', 'npm test && rm'))?.code).toBe('matcher-compound');
    expect(errorOf(allow('Bash', 'command-prefix', 'npm test $(x)'))?.code).toBe('matcher-compound');
    expect(errorOf(allow('Bash', 'command-prefix', 'echo "a"'))?.code).toBe('invalid-matcher');
  });

  it('refuses globs that reach outside the project or into secrets', () => {
    expect(errorOf(allow('Edit', 'path-glob', '../**'))?.code).toBe('invalid-matcher');
    expect(errorOf(allow('Edit', 'path-glob', '/**'))).toMatchObject({ code: 'matcher-too-broad', detail: 'path' });
    expect(errorOf(allow('Edit', 'path-glob', '/Users/**'))?.code).toBe('matcher-too-broad');
    expect(errorOf(allow('Write', 'path-glob', '/etc/*'))?.code).toBe('matcher-too-broad');
    expect(errorOf(allow('Write', 'path-glob', '.env*'))?.code).toBe('matcher-dangerous');
    expect(checkRuleDraft(allow('Edit', 'path-glob', 'src/**')).ok).toBe(true);
    expect(checkRuleDraft(allow('Edit', 'path-glob', '/demo/loja/src/**')).ok).toBe(true);
  });

  it('refuses hosts that are too broad or malformed', () => {
    expect(errorOf(allow('WebFetch', 'host', '*.com'))).toMatchObject({ code: 'matcher-too-broad', detail: 'host' });
    expect(errorOf(allow('WebFetch', 'host', 'not a host'))?.code).toBe('invalid-matcher');
    expect(checkRuleDraft(allow('WebFetch', 'host', 'Docs.Stripe.com')).ok).toBe(true);
    expect(checkRuleDraft(allow('WebFetch', 'host', '*.stripe.com')).ok).toBe(true);
  });

  it('lets deny rules be broad', () => {
    expect(
      checkRuleDraft({ effect: 'deny', tool: 'Bash', matcher: { kind: 'command-prefix', value: 'git push' } }).ok,
    ).toBe(true);
    expect(checkRuleDraft({ effect: 'deny', tool: 'Bash', matcher: { kind: 'any', value: '' } }).ok).toBe(true);
    expect(checkRuleDraft({ effect: 'deny', tool: 'mcp__*', matcher: { kind: 'any', value: '' } }).ok).toBe(true);
  });
});

describe('dangerOfPrefix', () => {
  it('names the risk when the detector knows it', () => {
    expect(dangerOfPrefix('sudo')).toBe('sudo');
    expect(dangerOfPrefix('git push')).toBe('command');
    expect(dangerOfPrefix('npm test')).toBeNull();
  });
});

describe('checkRulePatch', () => {
  it('replaces the named fields and revalidates the result', () => {
    const current = rule({ effect: 'deny', matcher: { kind: 'command-prefix', value: 'git push' } });
    const flipped = checkRulePatch(current, { effect: 'allow' });
    expect(flipped.ok).toBe(false);
    const renamed = checkRulePatch(current, { note: 'nunca', enabled: false });
    expect(renamed).toMatchObject({ ok: true, draft: { effect: 'deny', note: 'nunca', enabled: false } });
  });

  it('clears the note with null', () => {
    const current = rule({ note: 'x' });
    const cleared = checkRulePatch(current, { note: null });
    expect(cleared.ok && cleared.draft.note).toBeUndefined();
  });
});
