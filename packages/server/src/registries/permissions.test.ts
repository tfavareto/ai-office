import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PERMISSION_TTL_MS, PermissionRegistry } from './permissions';
import { summarizePermission, suggestionLabel, trimInput } from './permission-text';

let clock = 1_000_000;
let changes = 0;
const known = new Map<string, string>([['sess1', 'agent-main'], ['sess1/sub9', 'agent-sub']]);

function registry(): PermissionRegistry {
  return new PermissionRegistry({
    now: () => clock,
    resolveAgent: (session, raw) => known.get(raw === undefined ? session : `${session}/${raw}`),
    onChange: () => void changes++,
  });
}

beforeEach(() => {
  clock = 1_000_000;
  changes = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const request = { session_id: 'sess1', tool_name: 'Bash', tool_input: { command: 'npm test' } };

describe('PermissionRegistry', () => {
  test('creates a pending request for a known session and skips unknown ones', () => {
    const permissions = registry();
    expect(permissions.create({ ...request, session_id: 'nope' })).toEqual({ skip: 'unknown-session' });
    const created = permissions.create({ ...request, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }] });
    expect('id' in created).toBe(true);
    const id = (created as { id: string }).id;
    expect(permissions.get(id)).toMatchObject({ agentId: 'agent-main', toolName: 'Bash', summary: 'npm test', suggestions: ['Sempre permitir Bash(npm test:*) neste projeto'], expiresAt: clock + PERMISSION_TTL_MS });
    expect(permissions.pendingFor('agent-main')).toMatchObject({ id });
    expect(permissions.pendingFor('agent-main')).not.toHaveProperty('input');
    expect(changes).toBeGreaterThan(0);
  });

  test('routes subagent requests to the subagent', () => {
    const created = registry().create({ ...request, agent_id: 'sub9' });
    expect(created).toHaveProperty('id');
  });

  test('wait resolves as soon as a decision is made', async () => {
    const permissions = registry();
    const id = (permissions.create(request) as { id: string }).id;
    const waiting = permissions.wait(id, 25_000);
    expect(permissions.decide(id, { behavior: 'allow', suggestion: 0 })).toBe('ok');
    await expect(waiting).resolves.toEqual({ status: 'decided', behavior: 'allow', suggestion: 0 });
    expect(permissions.pendingFor('agent-main')).toBeUndefined();
  });

  test('wait returns "pending" after the timeout, capped at 25 s', async () => {
    const permissions = registry();
    const id = (permissions.create(request) as { id: string }).id;
    const waiting = permissions.wait(id, 600_000);
    await vi.advanceTimersByTimeAsync(24_999);
    let settled = false;
    void waiting.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await expect(waiting).resolves.toEqual({ status: 'pending' });
  });

  test('the first answer wins (409 semantics) and unknown ids are not found', () => {
    const permissions = registry();
    const id = (permissions.create(request) as { id: string }).id;
    expect(permissions.decide(id, { behavior: 'deny', message: 'não' })).toBe('ok');
    expect(permissions.decide(id, { behavior: 'allow' })).toBe('conflict');
    expect(permissions.decide('zzz', { behavior: 'allow' })).toBe('not-found');
  });

  test('requests expire after the TTL and are forgotten later', async () => {
    const permissions = registry();
    const id = (permissions.create(request) as { id: string }).id;
    clock += PERMISSION_TTL_MS + 1;
    permissions.sweep();
    await expect(permissions.wait(id, 0)).resolves.toEqual({ status: 'expired' });
    expect(permissions.decide(id, { behavior: 'allow' })).toBe('conflict');
    clock += 61_000;
    permissions.sweep();
    expect(permissions.get(id)).toBeUndefined();
  });

  test('hook timeout shortens the lifetime', () => {
    const permissions = registry();
    const id = (permissions.create({ ...request, timeout_ms: 10_000 }) as { id: string }).id;
    expect(permissions.get(id)?.expiresAt).toBe(clock + 10_000);
  });

  test('cancelFor ends pending requests when the session moved on', async () => {
    const permissions = registry();
    const id = (permissions.create(request) as { id: string }).id;
    const waiting = permissions.wait(id, 25_000);
    permissions.cancelFor('agent-main');
    await expect(waiting).resolves.toEqual({ status: 'cancelled' });
  });

  test('wait aborts with the client connection', async () => {
    const permissions = registry();
    const id = (permissions.create(request) as { id: string }).id;
    const controller = new AbortController();
    const waiting = permissions.wait(id, 25_000, controller.signal);
    controller.abort();
    await expect(waiting).resolves.toEqual({ status: 'pending' });
  });
});

describe('permission text', () => {
  test('summaries in pt-BR per tool', () => {
    expect(summarizePermission('Bash', { command: 'rm -rf dist' })).toBe('rm -rf dist');
    expect(summarizePermission('Edit', { file_path: 'src/app.ts' })).toBe('Editar src/app.ts');
    expect(summarizePermission('Write', { file_path: 'a.md' })).toBe('Escrever a.md');
    expect(summarizePermission('WebFetch', { url: 'https://docs.exemplo.com/x' })).toBe('Acessar docs.exemplo.com');
    expect(summarizePermission('mcp__github__create_issue', {})).toBe('github: create_issue');
    expect(summarizePermission('Outra', null)).toBe('Outra');
  });

  test('suggestion labels', () => {
    expect(suggestionLabel({ type: 'setMode', mode: 'acceptEdits', destination: 'session' })).toBe('Mudar para o modo acceptEdits nesta sessão');
    expect(suggestionLabel({ type: 'addDirectories', directories: ['/a', '/b'] })).toBe('Permitir acesso a /a, /b');
    expect(suggestionLabel({ type: 'addRules', behavior: 'allow', rules: [{ toolName: 'Read' }] })).toBe('Sempre permitir Read');
    expect(suggestionLabel(42)).toBe('Lembrar esta decisão');
  });

  test('trimInput cuts long strings, wide arrays and deep objects', () => {
    const trimmed = trimInput({ text: 'x'.repeat(5000), list: Array.from({ length: 100 }, (_, i) => i), deep: { a: { b: { c: { d: { e: { f: 1 } } } } } } }) as Record<string, unknown>;
    expect((trimmed.text as string).length).toBe(2001);
    expect(trimmed.list as unknown[]).toHaveLength(50);
    expect(JSON.stringify(trimmed.deep)).toContain('…');
  });
});
