import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  MAX_BODY_BYTES,
  buildDecisionOutput,
  buildPermissionBody,
  resolveTimeoutMs,
  trimStrings,
} from '../ai-office/hooks/permission.mjs';
import { FakeOffice, closedPort, runHookProcess, sendJson, sleep } from './helpers';

const SUGGESTIONS = [
  {
    type: 'addRules',
    rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
    behavior: 'allow',
    destination: 'localSettings',
  },
  { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
];

const request = (overrides: Record<string, unknown> = {}) => ({
  session_id: 'sess-1',
  hook_event_name: 'PermissionRequest',
  tool_name: 'Bash',
  tool_input: { command: 'npm test', description: 'Run tests' },
  permission_suggestions: SUGGESTIONS,
  cwd: '/work/project',
  ...overrides,
});

describe('pure helpers', () => {
  test('resolveTimeoutMs defaults to 300 s and clamps overrides to 5-1800 s', () => {
    expect(resolveTimeoutMs({})).toBe(300_000);
    expect(resolveTimeoutMs({ AI_OFFICE_PERMISSION_TIMEOUT: '1' })).toBe(5_000);
    expect(resolveTimeoutMs({ AI_OFFICE_PERMISSION_TIMEOUT: '99999' })).toBe(1_800_000);
    expect(resolveTimeoutMs({ AI_OFFICE_PERMISSION_TIMEOUT: '60' })).toBe(60_000);
    expect(resolveTimeoutMs({ AI_OFFICE_PERMISSION_TIMEOUT: 'abc' })).toBe(300_000);
  });

  test('trimStrings cuts long strings at any depth without mutating the original', () => {
    const original = { a: 'x'.repeat(100), nested: { list: ['y'.repeat(100), 'short', 3, null] } };
    const trimmed = trimStrings(original, 10) as typeof original;
    expect(trimmed.a.startsWith('x'.repeat(10))).toBe(true);
    expect(trimmed.a).toContain('+90 caracteres omitidos');
    expect(trimmed.nested.list[1]).toBe('short');
    expect(trimmed.nested.list[2]).toBe(3);
    expect(original.a).toHaveLength(100);
  });

  test('trimStrings does not split a surrogate pair', () => {
    const trimmed = trimStrings('a😀b', 2) as string;
    expect(trimmed.startsWith('a…')).toBe(true);
  });

  test('buildPermissionBody keeps a 7 KB string intact and trims a 10 KB one to 8 KB', () => {
    const small = buildPermissionBody(request({ tool_input: { content: 'a'.repeat(7000) } }), 1000) as any;
    expect(small.tool_input.content).toHaveLength(7000);
    const large = buildPermissionBody(request({ tool_input: { content: 'a'.repeat(10_000) } }), 1000) as any;
    expect(large.tool_input.content.startsWith('a'.repeat(8192))).toBe(true);
    expect(large.tool_input.content.length).toBeLessThan(8300);
  });

  test('buildPermissionBody shrinks strings further to stay under 200 KB and keeps suggestions', () => {
    const tool_input = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}`, 'z'.repeat(20_000)]));
    const body = buildPermissionBody(request({ tool_input, agent_id: 'sub-1' }), 5000) as any;
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(body.permission_suggestions).toEqual(SUGGESTIONS);
    expect(body.agent_id).toBe('sub-1');
    expect(body.timeout_ms).toBe(5000);
    expect(body.tool_input.f0.length).toBeLessThan(4200);
    expect(body.tool_input.f59.length).toBeGreaterThan(200);
  });

  test('buildPermissionBody omits an input that cannot fit at all', () => {
    const tool_input = { list: Array.from({ length: 200_000 }, (_, i) => `item-${i}`) };
    const body = buildPermissionBody(request({ tool_input }), 5000) as any;
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(body.tool_input.aviso).toMatch(/omitida/);
  });

  test('buildDecisionOutput maps allow, allow with suggestion, deny and terminal', () => {
    expect(buildDecisionOutput({ behavior: 'allow' }, SUGGESTIONS)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
    const withRule = buildDecisionOutput({ behavior: 'allow', suggestion: 1 }, SUGGESTIONS) as any;
    expect(withRule.hookSpecificOutput.decision.updatedPermissions).toEqual([SUGGESTIONS[1]]);
    const outOfRange = buildDecisionOutput({ behavior: 'allow', suggestion: 9 }, SUGGESTIONS) as any;
    expect(outOfRange.hookSpecificOutput.decision.updatedPermissions).toBeUndefined();
    expect(buildDecisionOutput({ behavior: 'deny', message: 'muito arriscado', interrupt: true }, [])).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'Recusado pelo usuário no AI Office: muito arriscado', interrupt: true },
      },
    });
    const bare = buildDecisionOutput({ behavior: 'deny' }, []) as any;
    expect(bare.hookSpecificOutput.decision).toEqual({
      behavior: 'deny',
      message: 'Recusado pelo usuário no AI Office.',
      interrupt: false,
    });
    expect(buildDecisionOutput({ behavior: 'terminal' }, [])).toBeNull();
  });
});

describe('denials by an approval rule', () => {
  test.each([
    [undefined, 'Recusado por regra do AI Office: Bash: git push'],
    ['pt-BR', 'Recusado por regra do AI Office: Bash: git push'],
    ['en', 'Denied by an AI Office rule: Bash: git push'],
    ['es', 'Rechazado por una regla de AI Office: Bash: git push'],
  ])('words a refusal with locale %s as a rule refusal', (locale, message) => {
    const output = buildDecisionOutput(
      { behavior: 'deny', auto: 'rule', message: 'Bash: git push', ...(locale !== undefined ? { locale } : {}) },
      [],
    ) as any;
    expect(output.hookSpecificOutput.decision).toEqual({ behavior: 'deny', message, interrupt: false });
  });

  test('an allow by a rule is a plain allow', () => {
    expect(buildDecisionOutput({ behavior: 'allow', auto: 'rule' }, [])).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
  });
});

describe('permission.mjs as a child process', () => {
  let office: FakeOffice;
  const env = () => ({ AI_OFFICE_PORT: String(office.port) });

  beforeEach(async () => {
    office = await new FakeOffice().start();
    office.json('POST /api/permissions', { id: 'perm-1' }, 201);
  });
  afterEach(() => office.stop());

  test('allow: prints the allow decision with the chosen original suggestion', async () => {
    office.json('GET /api/permissions/perm-1/wait', { status: 'decided', behavior: 'allow', suggestion: 0 });
    const run = await runHookProcess('permission', request(), env());

    expect(run.code).toBe(0);
    expect(run.output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow', updatedPermissions: [SUGGESTIONS[0]] },
      },
    });
    const [created] = office.requestsTo('POST /api/permissions');
    expect(created.body).toMatchObject({
      session_id: 'sess-1',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      permission_suggestions: SUGGESTIONS,
      cwd: '/work/project',
      timeout_ms: 300_000,
    });
    expect(office.requestsTo('GET /api/permissions/perm-1/wait')[0].query.get('timeout')).toBe('25');
  });

  test('deny: prints the deny decision with message and interrupt', async () => {
    office.json('GET /api/permissions/perm-1/wait', {
      status: 'decided',
      behavior: 'deny',
      message: 'não rode isso',
      interrupt: true,
    });
    const run = await runHookProcess('permission', request(), env());
    expect(run.output.hookSpecificOutput.decision).toEqual({
      behavior: 'deny',
      message: 'Recusado pelo usuário no AI Office: não rode isso',
      interrupt: true,
    });
  });

  test('keeps polling while pending, then delivers the decision', async () => {
    let polls = 0;
    office.on('GET /api/permissions/perm-1/wait', async (_req, res) => {
      polls += 1;
      await sleep(50);
      sendJson(res, polls < 3 ? { status: 'pending' } : { status: 'decided', behavior: 'allow' });
    });
    const run = await runHookProcess('permission', request(), env());
    expect(polls).toBe(3);
    expect(run.output.hookSpecificOutput.decision.behavior).toBe('allow');
  });

  test.each([
    ['terminal', { status: 'decided', behavior: 'terminal' }],
    ['expired', { status: 'expired' }],
    ['cancelled', { status: 'cancelled' }],
  ])('%s: exits 0 with no output', async (_name, answer) => {
    office.json('GET /api/permissions/perm-1/wait', answer);
    const run = await runHookProcess('permission', request(), env());
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
  });

  test('server answering skip: no wait, no output', async () => {
    office.json('POST /api/permissions', { skip: 'no page open' }, 200);
    const run = await runHookProcess('permission', request(), env());
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    expect(office.requestsTo('GET /api/permissions/perm-1/wait')).toHaveLength(0);
  });

  test('AskUserQuestion is never sent to the office', async () => {
    const run = await runHookProcess('permission', request({ tool_name: 'AskUserQuestion' }), env());
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    expect(office.requests).toHaveLength(0);
  });

  test('trims a huge tool_input so the body stays under 200 KB', async () => {
    office.json('GET /api/permissions/perm-1/wait', { status: 'expired' });
    const tool_input = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`file${i}`, 'q'.repeat(50_000)]));
    await runHookProcess('permission', request({ tool_input }), env());
    const [created] = office.requestsTo('POST /api/permissions');
    expect(created.bodyBytes).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(created.bodyBytes).toBeGreaterThan(1000);
  });

  test('gives up silently at the total timeout (AI_OFFICE_PERMISSION_TIMEOUT)', async () => {
    office.on('GET /api/permissions/perm-1/wait', async (_req, res) => {
      await sleep(300);
      sendJson(res, { status: 'pending' });
    });
    const run = await runHookProcess('permission', request(), { ...env(), AI_OFFICE_PERMISSION_TIMEOUT: '5' });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    expect(run.elapsedMs).toBeGreaterThanOrEqual(4_500);
    expect(run.elapsedMs).toBeLessThan(8_000);
    expect(office.requestsTo('POST /api/permissions')[0].body).toMatchObject({ timeout_ms: 5000 });
  }, 15_000);

  test('stops after repeated wait failures', async () => {
    office.json('GET /api/permissions/perm-1/wait', { error: 'boom' }, 500);
    const run = await runHookProcess('permission', request(), env());
    expect(run.stdout).toBe('');
    expect(office.requestsTo('GET /api/permissions/perm-1/wait')).toHaveLength(3);
  });

  test('invalid stdin: exits 0 silently', async () => {
    const run = await runHookProcess('permission', null, env(), 'not json');
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    expect(office.requests).toHaveLength(0);
  });

  test('AI_OFFICE_HOOK_DEBUG=1 logs to stderr only', async () => {
    office.json('GET /api/permissions/perm-1/wait', { status: 'expired' });
    const run = await runHookProcess('permission', request(), { ...env(), AI_OFFICE_HOOK_DEBUG: '1' });
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('[ai-office:permission]');
  });
});

describe('permission.mjs when AI Office is offline', () => {
  test('exits in under 1.5 s with no output', async () => {
    const port = await closedPort();
    const run = await runHookProcess('permission', request(), { AI_OFFICE_PORT: String(port) });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe('');
    expect(run.elapsedMs).toBeLessThan(1_500);
  });
});
