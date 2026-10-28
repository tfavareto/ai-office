import { describe, expect, it } from 'vitest';
import { createVoiceApi, VoiceApiError } from './api';
import { parseVoiceStatus } from './parse';

const body = {
  enabled: true,
  models: [{ size: 'base', id: 'whisper-base', bytes: 80, state: 'ready', downloadedBytes: 80 }],
};

const reply = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that answers `status` and `payload`, and remembers the requests. */
function fakeFetch(status: number, payload: unknown) {
  const calls: { path: string; init: RequestInit }[] = [];
  const fetchImpl = ((path: string, init: RequestInit) => {
    calls.push({ path, init });
    return Promise.resolve(reply(status, payload));
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('voice api', () => {
  it('reads the status from /api/voice/status', async () => {
    const { fetchImpl, calls } = fakeFetch(200, body);

    const status = await createVoiceApi(fetchImpl).status();

    expect(calls[0]?.path).toBe('/api/voice/status');
    expect(status.models[0]).toMatchObject({ size: 'base', state: 'ready' });
  });

  it('starts a download with a JSON POST naming the size', async () => {
    const { fetchImpl, calls } = fakeFetch(202, body);

    await createVoiceApi(fetchImpl).startDownload('small');

    expect(calls[0]?.path).toBe('/api/voice/download');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe('{"size":"small"}');
  });

  it('removes a model with a DELETE on its id', async () => {
    const { fetchImpl, calls } = fakeFetch(200, body);

    await createVoiceApi(fetchImpl).remove('tiny');

    expect(calls[0]?.path).toBe('/api/voice/model/whisper-tiny');
    expect(calls[0]?.init.method).toBe('DELETE');
  });

  it.each([
    [409, { error: 'voice-disabled' }, 'disabled'],
    [409, { error: 'voice-busy' }, 'busy'],
    [500, { error: 'internal-error' }, 'failed'],
    [200, { nope: true }, 'failed'],
  ])('maps %i %j to %s', async (status, payload, kind) => {
    const api = createVoiceApi(fakeFetch(status, payload).fetchImpl);

    await expect(api.status()).rejects.toEqual(new VoiceApiError(kind as 'busy'));
  });

  it('reports an unreachable server', async () => {
    const api = createVoiceApi((() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch);

    await expect(api.status()).rejects.toEqual(new VoiceApiError('unreachable'));
  });
});

describe('parseVoiceStatus', () => {
  it('leaves out models it cannot read and clamps the progress', () => {
    const parsed = parseVoiceStatus({
      enabled: false,
      models: [
        { size: 'tiny', bytes: 10, state: 'downloading', downloadedBytes: 99 },
        { size: 'huge', bytes: 10, state: 'ready' },
        { size: 'base', bytes: 'x', state: 'ready' },
        { size: 'small', bytes: 10, state: 'error', error: 'integrity', downloadedBytes: -3 },
        null,
      ],
    });

    expect(parsed.enabled).toBe(false);
    expect(parsed.models).toEqual([
      { size: 'tiny', id: 'whisper-tiny', bytes: 10, state: 'downloading', downloadedBytes: 10 },
      { size: 'small', id: 'whisper-small', bytes: 10, state: 'error', downloadedBytes: 0, error: 'integrity' },
    ]);
  });

  it.each([[null], [{}], [{ models: 3 }], ['x']])('rejects %j', (data) => {
    expect(() => parseVoiceStatus(data)).toThrow();
  });
});
