import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readToken, resolveTokenPath } from '../ai-office/hooks/lib.mjs';
import { FakeOffice, TEST_TOKEN, closedPort, makeStateDir, runHookProcess } from './helpers';

const OTHER_TOKEN = 'cd'.repeat(32);
const permissionInput = {
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command: 'ls' },
  hook_event_name: 'PermissionRequest',
};
const messageInput = { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Read' };

describe('token lookup', () => {
  test('prefers AI_OFFICE_STATE_DIR, falls back to ~/.ai-office and expands ~', () => {
    expect(resolveTokenPath({ AI_OFFICE_STATE_DIR: '/var/state' })).toBe('/var/state/token');
    expect(resolveTokenPath({ HOME: '/home/u' })).toBe('/home/u/.ai-office/token');
    expect(resolveTokenPath({ HOME: '/home/u', AI_OFFICE_STATE_DIR: '~/x' })).toBe('/home/u/x/token');
  });

  test('readToken accepts a well-formed token and rejects missing, short or odd files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ai-office-token-'));
    const env = { AI_OFFICE_STATE_DIR: dir };
    expect(readToken(env)).toBeNull();
    writeFileSync(join(dir, 'token'), `${TEST_TOKEN}\n`);
    expect(readToken(env)).toBe(TEST_TOKEN);
    writeFileSync(join(dir, 'token'), 'short');
    expect(readToken(env)).toBeNull();
    writeFileSync(join(dir, 'token'), `${TEST_TOKEN}\nmore`);
    expect(readToken(env)).toBeNull();
  });
});

describe('hooks without a usable token behave as "AI Office offline"', () => {
  let office: FakeOffice;
  beforeEach(async () => {
    office = await new FakeOffice().start();
    office.json('POST /api/permissions', { id: 'p1' }, 201);
    office.json('GET /api/permissions/p1/wait', { status: 'decided', behavior: 'allow' });
    office.json('POST /api/messages/inbox', { messages: [{ id: 'm', text: 'oi', createdAt: 1 }] });
    office.json('POST /api/attention', { ok: true });
  });
  afterEach(() => office.stop());

  const cases: [string, string | null][] = [
    ['the token file is missing', null],
    ['the token file is malformed', 'not a token'],
  ];
  for (const [name, content] of cases) {
    test(`silent exit and no network traffic when ${name}`, async () => {
      const env = { AI_OFFICE_PORT: String(office.port), AI_OFFICE_STATE_DIR: makeStateDir(content) };
      for (const [script, input] of [
        ['permission', permissionInput],
        ['messages', messageInput],
        ['notify', permissionInput],
      ] as const) {
        const run = await runHookProcess(script, input, env);
        expect(run.code).toBe(0);
        expect(run.stdout).toBe('');
      }
      expect(office.requests).toHaveLength(0);
      expect(office.challenges).toHaveLength(0);
    });
  }
});

describe('hooks check who they talk to', () => {
  const env = (office: FakeOffice, token = TEST_TOKEN) => ({
    AI_OFFICE_PORT: String(office.port),
    AI_OFFICE_STATE_DIR: makeStateDir(token),
  });
  let office: FakeOffice;
  afterEach(() => office?.stop());

  test('sends the bearer token (after the challenge) to a server that proves it knows the token', async () => {
    office = await new FakeOffice().start();
    office.json('POST /api/permissions', { id: 'p1' }, 201);
    office.json('GET /api/permissions/p1/wait', { status: 'decided', behavior: 'allow' });
    const run = await runHookProcess('permission', permissionInput, env(office));
    expect(run.output.hookSpecificOutput.decision.behavior).toBe('allow');
    expect(office.requests.length).toBeGreaterThanOrEqual(2);
    for (const request of office.requests) expect(request.headers.authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(office.challenges).toHaveLength(1);
  });

  test('uses a fresh random challenge for every hook run and never puts the token in the URL', async () => {
    office = await new FakeOffice().start();
    office.json('POST /api/attention', { ok: true });
    await runHookProcess('notify', permissionInput, env(office));
    await runHookProcess('notify', permissionInput, env(office));
    expect(new Set(office.challenges).size).toBe(2);
    for (const nonce of office.challenges) expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(office.challenges.join('')).not.toContain(TEST_TOKEN);
  });

  test('a server that knows another token never sees the token and the permission is not auto-approved', async () => {
    office = await new FakeOffice({ token: OTHER_TOKEN, requireAuth: false }).start();
    office.json('POST /api/permissions', { id: 'p1' }, 201);
    office.json('GET /api/permissions/p1/wait', { status: 'decided', behavior: 'allow' });
    const run = await runHookProcess('permission', permissionInput, env(office));
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    expect(office.requests).toHaveLength(0);
  });

  test('an impostor that answers no proof is treated as offline', async () => {
    office = await new FakeOffice({ proveIdentity: false, requireAuth: false }).start();
    office.json('POST /api/permissions', { id: 'p1' }, 201);
    office.json('GET /api/permissions/p1/wait', { status: 'decided', behavior: 'allow' });
    const run = await runHookProcess('permission', permissionInput, env(office));
    expect(run.stdout).toBe('');
    expect(office.requests).toHaveLength(0);
  });

  test('a 401 (wrong or rotated token) is treated as offline for every hook', async () => {
    office = await new FakeOffice({ requireAuth: false }).start();
    office.json('POST /api/permissions', { error: 'unauthorized' }, 401);
    office.json('POST /api/messages/inbox', { error: 'unauthorized' }, 401);
    office.json('POST /api/attention', { error: 'unauthorized' }, 401);
    for (const [script, input] of [
      ['permission', permissionInput],
      ['messages', messageInput],
      ['notify', permissionInput],
    ] as const) {
      const run = await runHookProcess(script, input, env(office));
      expect(run.code).toBe(0);
      expect(run.stdout).toBe('');
    }
  });

  test('a real 401 from the default fake (token mismatch after a valid proof) never yields a decision', async () => {
    office = await new FakeOffice({ requireAuth: true }).start();
    office.json('POST /api/permissions', { id: 'p1' }, 201);
    const run = await runHookProcess('permission', permissionInput, { ...env(office), AI_OFFICE_HOOK_DEBUG: '1' });
    expect(run.stdout).toBe('');
    expect(run.stderr).not.toContain(TEST_TOKEN);
  });

  test('offline server with a token still exits quickly', async () => {
    const port = await closedPort();
    const run = await runHookProcess('notify', permissionInput, {
      AI_OFFICE_PORT: String(port),
      AI_OFFICE_STATE_DIR: makeStateDir(),
    });
    expect(run.stdout).toBe('');
    expect(run.elapsedMs).toBeLessThan(1_500);
  });
});
