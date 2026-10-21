import type { PendingHire } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { snapshot } from '../test/fixtures';
import { BackendError } from './backend';
import { HttpBackend } from './http';
import { createMockEnvironment } from './mock';
import { parseFolderCheck, parseHire, parseHires, parseSnapshot } from './parse';

const HIRE: PendingHire = {
  id: 'h1',
  projectId: '/work/app',
  accountId: 'acc1',
  createdAt: 1000,
  expiresAt: 91_000,
  deskIndex: 2,
};

describe('pending hires in snapshots', () => {
  it('survive parsing', () => {
    const parsed = parseSnapshot(
      JSON.parse(JSON.stringify({ ...snapshot(), hires: [HIRE, { ...HIRE, id: 'h2', agentId: 'acc1:s' }] })),
    );

    expect(parsed?.hires).toHaveLength(2);
    expect(parsed?.hires?.[1]?.agentId).toBe('acc1:s');
  });

  it('are absent when the server sends none, and broken ones are dropped', () => {
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot())))?.hires).toBeUndefined();
    expect(parseSnapshot(JSON.parse(JSON.stringify({ ...snapshot(), hires: 'nope' })))?.hires).toBeUndefined();
    expect(
      parseHires([
        HIRE,
        { id: 'x' },
        null,
        { ...HIRE, deskIndex: -1 },
        { ...HIRE, deskIndex: 1.5 },
        { ...HIRE, agentId: 5 },
      ]),
    ).toEqual([HIRE]);
  });
});

describe('response parsers', () => {
  it('reads the hire out of a 202 body', () => {
    expect(parseHire({ hire: HIRE })).toEqual(HIRE);
    expect(() => parseHire({ hire: { id: 1 } })).toThrow();
    expect(() => parseHire(null)).toThrow();
  });

  it('reads a folder check and ignores an unknown reason', () => {
    expect(parseFolderCheck({ ok: true })).toEqual({ ok: true });
    expect(parseFolderCheck({ ok: false, reason: 'not-found' })).toEqual({ ok: false, reason: 'not-found' });
    expect(parseFolderCheck({ ok: false, reason: 'weird' })).toEqual({ ok: false });
    expect(() => parseFolderCheck({ reason: 'not-found' })).toThrow();
  });
});

describe('HttpBackend hiring', () => {
  function backend(respond: (url: string, init: RequestInit) => { status: number; body: unknown }): {
    http: HttpBackend;
    calls: { url: string; init: RequestInit }[];
  } {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init: init ?? {} });
      const { status, body } = respond(String(input), init ?? {});
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };
    return { http: new HttpBackend('', fetchImpl as typeof fetch), calls };
  }

  it('posts the request with the page language and returns the pending hire', async () => {
    const { http, calls } = backend(() => ({ status: 202, body: { hire: HIRE } }));

    const hire = await http.hireAgent({ projectPath: '/work/app', prompt: 'Hi', model: 'opus' });

    expect(hire).toEqual(HIRE);
    expect(calls[0]?.url).toBe('/api/agents/hire');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      projectPath: '/work/app',
      prompt: 'Hi',
      model: 'opus',
      locale: 'pt-BR',
    });
  });

  it('turns an error body into a BackendError whose message is the code', async () => {
    const { http } = backend(() => ({ status: 503, body: { error: 'no-terminal' } }));

    await expect(http.hireAgent({ projectPath: '/work/app' })).rejects.toMatchObject({
      name: 'BackendError',
      message: 'no-terminal',
      status: 503,
    });
    await expect(http.hireAgent({ projectPath: '/work/app' })).rejects.toBeInstanceOf(BackendError);
  });

  it('asks the server whether a folder will do, with the path in the query', async () => {
    const { http, calls } = backend(() => ({ status: 200, body: { ok: false, reason: 'not-found' } }));

    const result = await http.checkFolder('/work/my app');

    expect(result).toEqual({ ok: false, reason: 'not-found' });
    expect(calls[0]?.url).toBe('/api/agents/hire/check?path=%2Fwork%2Fmy+app');
  });
});

describe('mock backend hiring', () => {
  it('keeps a pending hire in the simulated office', async () => {
    const { backend } = createMockEnvironment();

    const hire = await backend.hireAgent({
      projectPath: '/Users/demo/projetos/loja-online',
      prompt: 'Revisar o checkout',
      deskIndex: 1,
    });

    expect(hire).toMatchObject({ demo: true, projectId: '/Users/demo/projetos/loja-online', deskIndex: 1 });
  });

  it('accepts absolute folders only', async () => {
    const { backend } = createMockEnvironment();

    expect(await backend.checkFolder('/anything')).toEqual({ ok: true });
    expect(await backend.checkFolder('relative')).toEqual({ ok: false, reason: 'not-absolute' });
  });
});
