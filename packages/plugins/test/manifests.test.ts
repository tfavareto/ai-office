import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { HOOKS_DIR, PLUGIN_DIR, REPO_ROOT } from './helpers';

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

const rootPackage = readJson(join(REPO_ROOT, 'package.json'));
const pluginManifest = readJson(join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'));
const marketplace = readJson(join(REPO_ROOT, '.claude-plugin', 'marketplace.json'));
const hooksFile = readJson(join(HOOKS_DIR, 'hooks.json'));

describe('versions', () => {
  test('plugin version equals the root package version', () => {
    expect(pluginManifest.version).toBe(rootPackage.version);
  });

  test('the plugins workspace package and any marketplace version agree too', () => {
    expect(readJson(join(REPO_ROOT, 'packages', 'plugins', 'package.json')).version).toBe(rootPackage.version);
    for (const plugin of marketplace.plugins) {
      if (plugin.version !== undefined) expect(plugin.version).toBe(rootPackage.version);
    }
  });
});

describe('plugin.json', () => {
  test('has the required metadata', () => {
    expect(pluginManifest).toMatchObject({
      name: 'ai-office',
      license: 'MIT',
      author: { name: 'Thiago Salazar Favareto' },
    });
    expect(pluginManifest.description).toBeTruthy();
    expect(pluginManifest.keywords.length).toBeGreaterThan(0);
  });
});

describe('marketplace.json', () => {
  test('is named ai-office and lists the plugin from its folder', () => {
    expect(marketplace.name).toBe('ai-office');
    expect(marketplace.owner.name).toBe('Thiago Salazar Favareto');
    expect(marketplace.plugins).toHaveLength(1);
    const [entry] = marketplace.plugins;
    expect(entry).toMatchObject({
      name: 'ai-office',
      source: './packages/plugins/ai-office',
      category: 'productivity',
    });
    expect(existsSync(join(REPO_ROOT, entry.source, '.claude-plugin', 'plugin.json'))).toBe(true);
  });
});

describe('hooks.json', () => {
  type HookEntry = { type: string; command: string; timeout: number; statusMessage?: string };
  const commandOf = (event: string): HookEntry => hooksFile.hooks[event][0].hooks[0];

  test('registers exactly the five events', () => {
    expect(Object.keys(hooksFile.hooks).sort()).toEqual([
      'Notification',
      'PermissionRequest',
      'PostToolUse',
      'Stop',
      'SubagentStop',
    ]);
  });

  test.each([
    ['PermissionRequest', 'permission.mjs', 330, 'Aguardando resposta no AI Office'],
    ['PostToolUse', 'messages.mjs', 10, undefined],
    ['Stop', 'messages.mjs', 660, 'De plantão: aguardando ordens no AI Office'],
    ['SubagentStop', 'messages.mjs', 10, undefined],
    ['Notification', 'notify.mjs', 5, undefined],
  ])('%s runs %s with timeout %i', (event, script, timeout, statusMessage) => {
    const hook = commandOf(event);
    expect(hook.type).toBe('command');
    expect(hook.command).toBe(`node "\${CLAUDE_PLUGIN_ROOT}/hooks/${script}"`);
    expect(hook.timeout).toBe(timeout);
    expect(hook.statusMessage).toBe(statusMessage);
    expect(existsSync(join(HOOKS_DIR, script))).toBe(true);
  });

  test('PermissionRequest and PostToolUse match every tool', () => {
    expect(hooksFile.hooks.PermissionRequest[0].matcher).toBe('*');
    expect(hooksFile.hooks.PostToolUse[0].matcher).toBe('*');
  });

  test('the Stop timeout leaves room for the 10 minute standby', () => {
    expect(commandOf('Stop').timeout).toBeGreaterThan(600);
  });
});

describe('hook scripts', () => {
  test.each(['lib.mjs', 'permission.mjs', 'messages.mjs', 'notify.mjs'])(
    '%s only imports node: modules and siblings',
    (file) => {
      const source = readFileSync(join(HOOKS_DIR, file), 'utf8');
      const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
      for (const specifier of specifiers) expect(specifier).toMatch(/^(node:|\.\/lib\.mjs$)/);
    },
  );
});
