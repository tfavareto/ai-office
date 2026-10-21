import { describe, expect, it } from 'vitest';
import { checkRuleDraft } from './validate';
import { PROJECT, bash, fetchUrl, file } from './fixtures';
import { commandPrefixOf, folderGlobOf, suggestRule } from './suggest';

describe('commandPrefixOf', () => {
  it.each([
    ['npm test', 'npm test'],
    ['npm test -- --watch', 'npm test'],
    ['npm install zod', 'npm install'],
    ['npm run build --workspace=web', 'npm run build'],
    ['pnpm exec vitest run', 'pnpm exec vitest'],
    ['git status -sb', 'git status'],
    ['ls -la src', 'ls'],
    ['node script.js', 'node'],
    ['cat package.json', 'cat'],
    ['pwd', 'pwd'],
  ])('%s -> %s', (command, prefix) => {
    expect(commandPrefixOf(command)).toBe(prefix);
  });
});

describe('folderGlobOf', () => {
  it('uses the folder inside the project, or the extension at its root', () => {
    expect(folderGlobOf(`${PROJECT}/src/cart/a.ts`, PROJECT)).toBe('src/cart/**');
    expect(folderGlobOf('src/a.ts', PROJECT)).toBe('src/**');
    expect(folderGlobOf(`${PROJECT}/README.md`, PROJECT)).toBe('*.md');
    expect(folderGlobOf(`${PROJECT}/Makefile`, PROJECT)).toBe('*');
    expect(folderGlobOf('/other/place/a.ts', PROJECT)).toBe('/other/place/**');
  });
});

describe('suggestRule', () => {
  it('suggests a command prefix for this project', () => {
    const suggestion = suggestRule(bash('npm install zod'));
    expect(suggestion).toEqual({
      effect: 'allow',
      tool: 'Bash',
      matcher: { kind: 'command-prefix', value: 'npm install' },
      scope: { projectPath: PROJECT },
      enabled: true,
    });
    expect(checkRuleDraft(suggestion).ok).toBe(true);
  });

  it('suggests an exact match for a compound command, which the editor then refuses to save', () => {
    const suggestion = suggestRule(bash('npm test && npm run build'));
    expect(suggestion.matcher).toEqual({ kind: 'exact', value: 'npm test && npm run build' });
    expect(checkRuleDraft(suggestion)).toMatchObject({ ok: false, error: { code: 'matcher-compound' } });
  });

  it('suggests a deny rule for a risky request', () => {
    const suggestion = suggestRule(bash('git push --force origin main'));
    expect(suggestion).toMatchObject({ effect: 'deny', matcher: { kind: 'command-prefix', value: 'git push' } });
    expect(checkRuleDraft(suggestion).ok).toBe(true);
  });

  it('suggests a folder glob for file tools', () => {
    const suggestion = suggestRule(file('Edit', `${PROJECT}/src/config.ts`));
    expect(suggestion).toMatchObject({ tool: 'Edit', matcher: { kind: 'path-glob', value: 'src/**' } });
    expect(checkRuleDraft(suggestion).ok).toBe(true);
  });

  it('suggests the host for web fetches and any for other tools', () => {
    expect(suggestRule(fetchUrl('https://docs.stripe.com/api'))).toMatchObject({
      tool: 'WebFetch',
      matcher: { kind: 'host', value: 'docs.stripe.com' },
    });
    expect(suggestRule({ toolName: 'mcp__docs__search', input: {}, summary: 'docs: search' })).toMatchObject({
      tool: 'mcp__docs__search',
      matcher: { kind: 'any', value: '' },
      scope: {},
    });
  });
});
