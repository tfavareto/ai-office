import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildAttentionBody } from '../ai-office/hooks/notify.mjs';
import { FakeOffice, closedPort, runHookProcess } from './helpers';

describe('buildAttentionBody', () => {
  test('keeps session, optional agent and message', () => {
    expect(buildAttentionBody({ session_id: 's', agent_id: 'a', message: 'Claude precisa da sua permissão' })).toEqual({
      session_id: 's',
      agent_id: 'a',
      message: 'Claude precisa da sua permissão',
    });
    expect(buildAttentionBody({ session_id: 's' })).toEqual({ session_id: 's' });
    expect(buildAttentionBody({ message: 'x' })).toBeNull();
  });

  test('caps very long messages', () => {
    expect(buildAttentionBody({ session_id: 's', message: 'm'.repeat(5000) })?.message).toHaveLength(1000);
  });
});

describe('notify.mjs as a child process', () => {
  let office: FakeOffice;
  beforeEach(async () => {
    office = await new FakeOffice().start();
    office.json('POST /api/attention', { ok: true });
  });
  afterEach(() => office.stop());

  test('posts the attention request and prints nothing', async () => {
    const run = await runHookProcess(
      'notify',
      {
        session_id: 's1',
        hook_event_name: 'Notification',
        message: 'Claude is waiting for your input',
        agent_id: 'ag-1',
      },
      { AI_OFFICE_PORT: String(office.port) },
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    const [posted] = office.requestsTo('POST /api/attention');
    expect(posted.body).toEqual({ session_id: 's1', agent_id: 'ag-1', message: 'Claude is waiting for your input' });
  });

  test('without a session nothing is posted', async () => {
    await runHookProcess('notify', { hook_event_name: 'Notification' }, { AI_OFFICE_PORT: String(office.port) });
    expect(office.requests).toHaveLength(0);
  });

  test('offline: exits in under 1.5 s with no output', async () => {
    const port = await closedPort();
    const run = await runHookProcess('notify', { session_id: 's1', message: 'x' }, { AI_OFFICE_PORT: String(port) });
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    expect(run.elapsedMs).toBeLessThan(1_500);
  });

  test('server errors are swallowed', async () => {
    office.json('POST /api/attention', { error: 'boom' }, 500);
    const run = await runHookProcess(
      'notify',
      { session_id: 's1', message: 'x' },
      { AI_OFFICE_PORT: String(office.port) },
    );
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
  });
});
