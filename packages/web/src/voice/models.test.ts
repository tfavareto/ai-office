import type { VoiceModelSize, VoiceModelStatus, VoiceStatusResponse } from '@ai-office/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceApiError, type VoiceApi } from './api';
import { DOWNLOAD_POLL_MS } from './constants';
import { createVoiceModels, VoiceDownloadError } from './models';

function model(size: VoiceModelSize, extra: Partial<VoiceModelStatus> = {}): VoiceModelStatus {
  return { size, id: `whisper-${size}`, bytes: 1000, state: 'missing', downloadedBytes: 0, ...extra };
}

const response = (...models: VoiceModelStatus[]): VoiceStatusResponse => ({ enabled: true, models });

function fakeApi(initial: VoiceStatusResponse) {
  let status = initial;
  const calls: string[] = [];
  const api: VoiceApi = {
    status: () => {
      calls.push('status');
      return Promise.resolve(status);
    },
    startDownload: (size) => {
      calls.push(`download:${size}`);
      return Promise.resolve(status);
    },
    remove: (size) => {
      calls.push(`remove:${size}`);
      status = response(model(size));
      return Promise.resolve(status);
    },
  };
  return { api, calls, set: (next: VoiceStatusResponse) => (status = next) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('voice models', () => {
  it('knows nothing until it reads the status, then keeps it', async () => {
    const { api } = fakeApi(response(model('base')));
    const models = createVoiceModels(api);
    expect(models.current()).toBeNull();

    await models.refresh();

    expect(models.statusOf('base')?.state).toBe('missing');
    expect(models.statusOf('tiny')).toBeUndefined();
  });

  it('forgets the status when the server cannot be reached, and tells the listeners', async () => {
    const api: VoiceApi = {
      ...fakeApi(response()).api,
      status: () => Promise.reject(new VoiceApiError('unreachable')),
    };
    const models = createVoiceModels(api);
    const listener = vi.fn();
    models.onChange(listener);

    await models.refresh();

    expect(models.current()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('follows a download with polls until the model is ready', async () => {
    const rig = fakeApi(response(model('base', { state: 'downloading', downloadedBytes: 100 })));
    const models = createVoiceModels(rig.api);
    const seen: number[] = [];
    models.onChange(() => seen.push(models.statusOf('base')?.downloadedBytes ?? -1));

    const done = models.download('base');
    rig.set(response(model('base', { state: 'downloading', downloadedBytes: 600 })));
    await vi.advanceTimersByTimeAsync(DOWNLOAD_POLL_MS);
    rig.set(response(model('base', { state: 'ready', downloadedBytes: 1000 })));
    await vi.advanceTimersByTimeAsync(DOWNLOAD_POLL_MS);
    await done;

    expect(seen).toEqual([100, 600, 1000]);
    expect(models.statusOf('base')?.state).toBe('ready');
    // Polling stops once nothing downloads.
    const polls = rig.calls.filter((call) => call === 'status').length;
    await vi.advanceTimersByTimeAsync(DOWNLOAD_POLL_MS * 5);
    expect(rig.calls.filter((call) => call === 'status')).toHaveLength(polls);
  });

  it("rejects with the server's reason when the download fails", async () => {
    const rig = fakeApi(response(model('base', { state: 'downloading' })));
    const models = createVoiceModels(rig.api);

    const done = models.download('base');
    const outcome = done.catch((error: unknown) => error);
    rig.set(response(model('base', { state: 'error', error: 'integrity' })));
    await vi.advanceTimersByTimeAsync(DOWNLOAD_POLL_MS);

    expect(await outcome).toEqual(new VoiceDownloadError('integrity'));
  });

  it('rejects as cancelled when the model is removed meanwhile', async () => {
    const rig = fakeApi(response(model('base', { state: 'downloading' })));
    const models = createVoiceModels(rig.api);

    const outcome = models.download('base').catch((error: unknown) => error);
    await models.remove('base');

    expect(await outcome).toEqual(new VoiceDownloadError('cancelled'));
  });

  it.each([
    ['busy', 'busy'],
    ['disabled', 'disabled'],
    ['unreachable', 'unreachable'],
    ['failed', 'network'],
  ] as const)('turns a refused start (%s) into the code %s', async (kind, code) => {
    const api: VoiceApi = { ...fakeApi(response()).api, startDownload: () => Promise.reject(new VoiceApiError(kind)) };

    await expect(createVoiceModels(api).download('base')).rejects.toEqual(new VoiceDownloadError(code));
  });

  it('gives up on a download it can no longer follow', async () => {
    const rig = fakeApi(response(model('base', { state: 'downloading' })));
    const models = createVoiceModels({ ...rig.api, status: () => Promise.reject(new VoiceApiError('unreachable')) });

    const outcome = models.download('base').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(DOWNLOAD_POLL_MS * 6);

    expect(await outcome).toEqual(new VoiceDownloadError('unreachable'));
    expect(models.current()).toBeNull();
  });

  it('starts following a download that was begun elsewhere (another tab, Settings)', async () => {
    const rig = fakeApi(response(model('base', { state: 'downloading', downloadedBytes: 10 })));
    const models = createVoiceModels(rig.api);
    await models.refresh();
    rig.set(response(model('base', { state: 'downloading', downloadedBytes: 500 })));

    await vi.advanceTimersByTimeAsync(DOWNLOAD_POLL_MS);

    expect(models.statusOf('base')?.downloadedBytes).toBe(500);
  });

  it('stops notifying a listener that unsubscribed', async () => {
    const models = createVoiceModels(fakeApi(response(model('base'))).api);
    const listener = vi.fn();
    const off = models.onChange(listener);
    off();

    await models.refresh();

    expect(listener).not.toHaveBeenCalled();
  });
});
