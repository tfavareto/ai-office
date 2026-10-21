// What the hooks tell the agent is phrased in the language of the person who wrote the message / answered the dialog.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_LOCALE, normalizeLocale } from '../ai-office/hooks/lib.mjs';
import { buildStopOutput, buildToolOutput, readInbox } from '../ai-office/hooks/messages.mjs';
import { buildDecisionOutput } from '../ai-office/hooks/permission.mjs';
import { FakeOffice, runHookProcess, sleep, sendJson } from './helpers';

const ok = (json: unknown) => ({ ok: true, status: 200, json });
const context = (output: unknown) => (output as any).hookSpecificOutput.additionalContext as string;
const reason = (output: unknown) => (output as any).reason as string;
const denyMessage = (output: unknown) => (output as any).hookSpecificOutput.decision.message as string;

describe('normalizeLocale', () => {
  test('accepts the three interface languages and falls back to pt-BR for anything else', () => {
    expect(['pt-BR', 'en', 'es'].map(normalizeLocale)).toEqual(['pt-BR', 'en', 'es']);
    expect([undefined, null, 'fr', 'pt', 'EN', 7, {}].map(normalizeLocale)).toEqual(Array(7).fill(DEFAULT_LOCALE));
  });
});

describe('delivery preamble', () => {
  test('PostToolUse: one and several messages in every language, pt-BR by default', () => {
    expect(context(buildToolOutput(['a']))).toMatch(/^Mensagem do usuário \(seu chefe\) enviada agora pelo AI Office/);
    expect(context(buildToolOutput(['a'], 'pt-BR'))).toBe(context(buildToolOutput(['a'])));
    expect(context(buildToolOutput(['a'], 'fr'))).toBe(context(buildToolOutput(['a'])));
    expect(context(buildToolOutput(['a'], 'en'))).toBe(
      'Message from the user (your boss) sent just now through AI Office while you were working. Take it into account and adjust course if needed:\n\na',
    );
    expect(context(buildToolOutput(['a', 'b'], 'en'))).toBe(
      'Messages from the user (your boss) sent just now through AI Office while you were working. Take them into account and adjust course if needed:\n\n1. a\n2. b',
    );
    expect(context(buildToolOutput(['a'], 'es'))).toBe(
      'Mensaje del usuario (tu jefe) enviado ahora por AI Office mientras trabajabas. Tenlo en cuenta y ajusta el rumbo si es necesario:\n\na',
    );
    expect(context(buildToolOutput(['a', 'b'], 'es'))).toMatch(
      /^Mensajes del usuario \(tu jefe\) enviados ahora por AI Office/,
    );
  });

  test('Stop: one and several messages in every language, pt-BR by default', () => {
    expect(reason(buildStopOutput(['a']))).toMatch(/^Nova mensagem do usuário \(seu chefe\) pelo AI Office/);
    expect(reason(buildStopOutput(['a', 'b']))).toMatch(/^Novas mensagens do usuário \(seu chefe\) pelo AI Office/);
    expect(reason(buildStopOutput(['a'], 'en'))).toBe(
      'New message from the user (your boss) through AI Office. Treat it as a new instruction and respond to it before finishing:\n\na',
    );
    expect(reason(buildStopOutput(['a', 'b'], 'en'))).toMatch(
      /^New messages from the user \(your boss\) through AI Office\. Treat them as new instructions/,
    );
    expect(reason(buildStopOutput(['a'], 'es'))).toBe(
      'Nuevo mensaje del usuario (tu jefe) por AI Office. Trátalo como una nueva instrucción y respóndelo antes de terminar:\n\na',
    );
    expect(reason(buildStopOutput(['a', 'b'], 'es'))).toMatch(/^Nuevos mensajes del usuario \(tu jefe\) por AI Office/);
    expect((buildStopOutput(['a'], 'es') as any).decision).toBe('block');
  });

  test('readInbox reports the language of the most recent message that declared one', () => {
    const message = (text: string, locale?: unknown) => ({
      id: text,
      text,
      createdAt: 1,
      ...(locale === undefined ? {} : { locale }),
    });
    expect(readInbox(ok({ messages: [message('a', 'es'), message('b', 'en')] })).locale).toBe('en');
    expect(readInbox(ok({ messages: [message('a', 'en'), message('b')] })).locale).toBe('en');
    expect(readInbox(ok({ messages: [message('a', 'fr')] }))).toEqual({ texts: ['a'], skip: false, failed: false });
    expect(readInbox(ok({ messages: [message('a')] }))).toEqual({ texts: ['a'], skip: false, failed: false });
    expect('locale' in readInbox(ok({ messages: [message('a')] }))).toBe(false);
  });
});

describe('deny message', () => {
  test('is phrased in the language of the decision, pt-BR when absent or unknown', () => {
    expect(denyMessage(buildDecisionOutput({ behavior: 'deny' }, []))).toBe('Recusado pelo usuário no AI Office.');
    expect(denyMessage(buildDecisionOutput({ behavior: 'deny', message: 'x', locale: 'xx' }, []))).toBe(
      'Recusado pelo usuário no AI Office: x',
    );
    expect(denyMessage(buildDecisionOutput({ behavior: 'deny', locale: 'en' }, []))).toBe(
      'Denied by the user in AI Office.',
    );
    expect(denyMessage(buildDecisionOutput({ behavior: 'deny', message: 'too risky', locale: 'en' }, []))).toBe(
      'Denied by the user in AI Office: too risky',
    );
    expect(denyMessage(buildDecisionOutput({ behavior: 'deny', locale: 'es' }, []))).toBe(
      'Rechazado por el usuario en AI Office.',
    );
    expect(denyMessage(buildDecisionOutput({ behavior: 'deny', message: 'muy arriesgado', locale: 'es' }, []))).toBe(
      'Rechazado por el usuario en AI Office: muy arriesgado',
    );
  });

  test('the language does not change allow or terminal decisions', () => {
    expect(buildDecisionOutput({ behavior: 'allow', locale: 'en' }, [])).toEqual(
      buildDecisionOutput({ behavior: 'allow' }, []),
    );
    expect(buildDecisionOutput({ behavior: 'terminal', locale: 'es' }, [])).toBeNull();
  });
});

describe('hooks as child processes', () => {
  let office: FakeOffice;
  const env = () => ({ AI_OFFICE_PORT: String(office.port) });

  beforeEach(async () => {
    office = await new FakeOffice().start();
  });
  afterEach(() => office.stop());

  test('messages.mjs PostToolUse phrases the preamble in the language the server reports', async () => {
    office.json('POST /api/messages/inbox', { messages: [{ id: 'm1', text: 'use pnpm', createdAt: 1, locale: 'en' }] });
    const run = await runHookProcess(
      'messages',
      { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Read' },
      env(),
    );
    expect(context(run.output)).toMatch(/^Message from the user \(your boss\) sent just now/);
    expect(context(run.output).endsWith('\n\nuse pnpm')).toBe(true);
  });

  test('messages.mjs Stop standby keeps the language of the message that wakes it up', async () => {
    office.json('POST /api/messages/inbox', { messages: [] });
    let waits = 0;
    office.on('GET /api/messages/wait', async (_req, res) => {
      waits += 1;
      await sleep(100);
      sendJson(
        res,
        waits < 2 ? { messages: [] } : { messages: [{ id: 'm2', text: 'despierta', createdAt: 1, locale: 'es' }] },
      );
    });
    const run = await runHookProcess(
      'messages',
      { session_id: 's1', hook_event_name: 'Stop', stop_hook_active: false },
      { ...env(), AI_OFFICE_STANDBY_MIN: '1' },
    );
    expect(run.output.decision).toBe('block');
    expect(reason(run.output)).toMatch(/^Nuevo mensaje del usuario \(tu jefe\) por AI Office/);
  });

  test('messages.mjs without a language keeps the Portuguese preamble', async () => {
    office.json('POST /api/messages/inbox', { messages: [{ id: 'm3', text: 'oi', createdAt: 1 }] });
    const run = await runHookProcess(
      'messages',
      { session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Read' },
      env(),
    );
    expect(context(run.output)).toMatch(/^Mensagem do usuário \(seu chefe\)/);
  });

  test('permission.mjs phrases a denial in the language of the answer', async () => {
    office.json('POST /api/permissions', { id: 'perm-1' }, 201);
    office.json('GET /api/permissions/perm-1/wait', {
      status: 'decided',
      behavior: 'deny',
      message: 'do not run it',
      interrupt: false,
      locale: 'en',
    });
    const run = await runHookProcess(
      'permission',
      {
        session_id: 'sess-1',
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /' },
      },
      env(),
    );
    expect(run.output.hookSpecificOutput.decision).toEqual({
      behavior: 'deny',
      message: 'Denied by the user in AI Office: do not run it',
      interrupt: false,
    });
  });
});
