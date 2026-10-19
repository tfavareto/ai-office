import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  buildStopOutput,
  buildToolOutput,
  formatMessages,
  readInbox,
  resolveStandbyMs,
} from '../ai-office/hooks/messages.mjs';
import { FakeOffice, closedPort, runHookProcess, sendJson, sleep } from './helpers';

const message = (text: string, id = text) => ({ id, text, createdAt: 1 });

describe('pure helpers', () => {
  test('resolveStandbyMs defaults to 10 min, caps at 10 and 0 disables', () => {
    expect(resolveStandbyMs({})).toBe(600_000);
    expect(resolveStandbyMs({ AI_OFFICE_STANDBY_MIN: '30' })).toBe(600_000);
    expect(resolveStandbyMs({ AI_OFFICE_STANDBY_MIN: '0' })).toBe(0);
    expect(resolveStandbyMs({ AI_OFFICE_STANDBY_MIN: '-4' })).toBe(0);
    expect(resolveStandbyMs({ AI_OFFICE_STANDBY_MIN: '2' })).toBe(120_000);
    expect(resolveStandbyMs({ AI_OFFICE_STANDBY_MIN: 'x' })).toBe(600_000);
  });

  test('formatMessages gives bare text for one message and a numbered list for several', () => {
    expect(formatMessages(['só uma'])).toBe('só uma');
    expect(formatMessages(['primeira', 'segunda'])).toBe('1. primeira\n2. segunda');
  });

  test('outputs carry the Portuguese headers and the text', () => {
    const tool = buildToolOutput(['rode os testes']) as any;
    expect(tool.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(tool.hookSpecificOutput.additionalContext).toMatch(
      /^Mensagem do usuário \(seu chefe\) enviada agora pelo AI Office/,
    );
    expect(tool.hookSpecificOutput.additionalContext.endsWith('\n\nrode os testes')).toBe(true);

    const stop = buildStopOutput(['a', 'b']) as any;
    expect(stop.decision).toBe('block');
    expect(stop.reason).toMatch(/^Novas mensagens do usuário \(seu chefe\) pelo AI Office/);
    expect(stop.reason.endsWith('\n\n1. a\n2. b')).toBe(true);
    expect((buildStopOutput(['a']) as any).reason).toMatch(/^Nova mensagem do usuário \(seu chefe\) pelo AI Office/);
  });

  test('readInbox classifies responses', () => {
    const ok = (json: unknown) => ({ ok: true, status: 200, json });
    expect(readInbox(ok({ messages: [message('oi'), { id: 'x', text: '  ' }, { id: 'y' }] }))).toEqual({
      texts: ['oi'],
      skip: false,
      failed: false,
    });
    expect(readInbox(ok({ messages: [] }))).toEqual({ texts: [], skip: false, failed: false });
    expect(readInbox(ok({ skip: 'no viewers' }))).toEqual({ texts: [], skip: true, failed: false });
    expect(readInbox(ok({ nope: true })).failed).toBe(true);
    expect(readInbox({ ok: false, status: 500, json: null }).failed).toBe(true);
    expect(readInbox(null).failed).toBe(true);
  });
});

describe('messages.mjs as a child process', () => {
  let office: FakeOffice;
  const env = (extra: Record<string, string> = {}) => ({ AI_OFFICE_PORT: String(office.port), ...extra });

  beforeEach(async () => {
    office = await new FakeOffice().start();
  });
  afterEach(() => office.stop());

  describe('PostToolUse', () => {
    const input = { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Read' };

    test('delivers a queued message as additionalContext (via=tool)', async () => {
      office.json('GET /api/messages/inbox', { messages: [message('use pnpm')] });
      const run = await runHookProcess('messages', input, env());

      expect(run.code).toBe(0);
      expect(run.output.hookSpecificOutput.hookEventName).toBe('PostToolUse');
      expect(run.output.hookSpecificOutput.additionalContext).toContain('use pnpm');
      const [inbox] = office.requestsTo('GET /api/messages/inbox');
      expect(inbox.query.get('via')).toBe('tool');
      expect(inbox.query.get('session')).toBe('s1');
      expect(inbox.query.has('agent')).toBe(false);
    });

    test('passes agent_id when a subagent runs the tool, and numbers several messages', async () => {
      office.json('GET /api/messages/inbox', { messages: [message('um'), message('dois')] });
      const run = await runHookProcess('messages', { ...input, agent_id: 'ag-7' }, env());
      expect(office.requestsTo('GET /api/messages/inbox')[0].query.get('agent')).toBe('ag-7');
      expect(run.output.hookSpecificOutput.additionalContext).toContain('1. um\n2. dois');
    });

    test('empty inbox or skip: no output', async () => {
      office.json('GET /api/messages/inbox', { messages: [] });
      expect((await runHookProcess('messages', input, env())).stdout).toBe('');
      office.json('GET /api/messages/inbox', { skip: 'unknown session' });
      expect((await runHookProcess('messages', input, env())).stdout).toBe('');
    });
  });

  describe('Stop', () => {
    const input = { session_id: 's1', hook_event_name: 'Stop', stop_hook_active: false };

    test('blocks with the queued message as reason (via=stop) without waiting', async () => {
      office.json('GET /api/messages/inbox', { messages: [message('finalize e resuma')] });
      const run = await runHookProcess('messages', input, env());

      expect(run.output.decision).toBe('block');
      expect(run.output.reason).toContain('finalize e resuma');
      expect(office.requestsTo('GET /api/messages/inbox')[0].query.get('via')).toBe('stop');
      expect(office.requestsTo('GET /api/messages/wait')).toHaveLength(0);
    });

    test('standby wake-up: waits, then blocks with the message that arrives', async () => {
      office.json('GET /api/messages/inbox', { messages: [] });
      let waits = 0;
      office.on('GET /api/messages/wait', async (_req, res) => {
        waits += 1;
        await sleep(150);
        sendJson(res, waits < 2 ? { messages: [] } : { messages: [message('acorde, tem trabalho')] });
      });
      const run = await runHookProcess('messages', input, env({ AI_OFFICE_STANDBY_MIN: '1' }));

      expect(waits).toBe(2);
      expect(run.output.decision).toBe('block');
      expect(run.output.reason).toContain('acorde, tem trabalho');
      const first = office.requestsTo('GET /api/messages/wait')[0];
      expect(first.query.get('timeout')).toBe('25');
      expect(first.query.get('session')).toBe('s1');
    });

    test('standby respects its total budget and then exits silently', async () => {
      office.json('GET /api/messages/inbox', { messages: [] });
      office.on('GET /api/messages/wait', async (_req, res) => {
        await sleep(100);
        sendJson(res, { messages: [] });
      });
      const run = await runHookProcess('messages', input, env({ AI_OFFICE_STANDBY_MIN: '0.05' }));
      expect(run.stdout).toBe('');
      expect(run.elapsedMs).toBeGreaterThanOrEqual(2_800);
      expect(run.elapsedMs).toBeLessThan(6_000);
      // 3 s budget: the last wait is capped to the time that is left.
      const timeouts = office.requestsTo('GET /api/messages/wait').map((r) => Number(r.query.get('timeout')));
      expect(Math.max(...timeouts)).toBeLessThanOrEqual(3);
    }, 15_000);

    test('standby disabled (AI_OFFICE_STANDBY_MIN=0): never waits', async () => {
      office.json('GET /api/messages/inbox', { messages: [] });
      const run = await runHookProcess('messages', input, env({ AI_OFFICE_STANDBY_MIN: '0' }));
      expect(run.stdout).toBe('');
      expect(run.elapsedMs).toBeLessThan(1_500);
      expect(office.requestsTo('GET /api/messages/wait')).toHaveLength(0);
    });

    test('no viewers: a skip from the wait endpoint ends the standby at once', async () => {
      office.json('GET /api/messages/inbox', { messages: [] });
      office.json('GET /api/messages/wait', { skip: 'no viewers' });
      const run = await runHookProcess('messages', input, env());
      expect(run.stdout).toBe('');
      expect(run.elapsedMs).toBeLessThan(1_500);
      expect(office.requestsTo('GET /api/messages/wait')).toHaveLength(1);
    });

    test('a skip from the inbox skips the standby entirely', async () => {
      office.json('GET /api/messages/inbox', { skip: 'unknown session' });
      const run = await runHookProcess('messages', input, env());
      expect(run.stdout).toBe('');
      expect(office.requestsTo('GET /api/messages/wait')).toHaveLength(0);
    });
  });

  describe('SubagentStop', () => {
    test('without agent_id nothing is requested', async () => {
      office.json('GET /api/messages/inbox', { messages: [message('x')] });
      const run = await runHookProcess('messages', { session_id: 's1', hook_event_name: 'SubagentStop' }, env());
      expect(run.stdout).toBe('');
      expect(office.requests).toHaveLength(0);
    });

    test('with agent_id delivers via=stop for that agent and never stands by', async () => {
      office.json('GET /api/messages/inbox', { messages: [message('ajuste o plano')] });
      const run = await runHookProcess(
        'messages',
        { session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'ag-3' },
        env(),
      );
      expect(run.output.decision).toBe('block');
      expect(run.output.reason).toContain('ajuste o plano');
      const [inbox] = office.requestsTo('GET /api/messages/inbox');
      expect(inbox.query.get('agent')).toBe('ag-3');
      expect(inbox.query.get('via')).toBe('stop');
    });

    test('empty inbox: exits without standby', async () => {
      office.json('GET /api/messages/inbox', { messages: [] });
      const run = await runHookProcess(
        'messages',
        { session_id: 's1', hook_event_name: 'SubagentStop', agent_id: 'ag-3' },
        env(),
      );
      expect(run.stdout).toBe('');
      expect(office.requestsTo('GET /api/messages/wait')).toHaveLength(0);
    });
  });

  test('unknown events and missing session are ignored', async () => {
    const other = await runHookProcess('messages', { session_id: 's1', hook_event_name: 'PreToolUse' }, env());
    const noSession = await runHookProcess('messages', { hook_event_name: 'PostToolUse' }, env());
    expect(other.stdout + noSession.stdout).toBe('');
    expect(office.requests).toHaveLength(0);
  });
});

describe('messages.mjs when AI Office is offline', () => {
  test.each(['PostToolUse', 'Stop', 'SubagentStop'])('%s exits in under 1.5 s with no output', async (event) => {
    const port = await closedPort();
    const run = await runHookProcess(
      'messages',
      { session_id: 's1', hook_event_name: event, agent_id: 'a1' },
      { AI_OFFICE_PORT: String(port) },
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe('');
    expect(run.elapsedMs).toBeLessThan(1_500);
  });
});
