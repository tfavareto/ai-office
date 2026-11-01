// The speech models as the page sees them: the server's status (kept fresh while a download runs), and the actions
// that download and remove them. The voice input and the settings row share one of these.
import type { VoiceDownloadErrorCode, VoiceModelSize, VoiceModelStatus, VoiceStatusResponse } from '@ai-office/shared';
import { VoiceApiError, type VoiceApi } from './api';
import { DOWNLOAD_POLL_MS } from './constants';

/** Why a download did not finish: the server's reason, or one the page found out itself. */
export type VoiceDownloadFailureCode = VoiceDownloadErrorCode | 'busy' | 'disabled' | 'unreachable' | 'cancelled';

export class VoiceDownloadError extends Error {
  constructor(readonly code: VoiceDownloadFailureCode) {
    super(code);
    this.name = 'VoiceDownloadError';
  }
}

export interface VoiceModels {
  /** The last status the server gave; null before the first answer or when the server cannot be reached. */
  current(): VoiceStatusResponse | null;
  statusOf(size: VoiceModelSize): VoiceModelStatus | undefined;
  onChange(listener: () => void): () => void;
  /** Reads the status now. Never rejects: an unreachable server makes `current()` null. */
  refresh(): Promise<void>;
  /** Starts the download (an explicit action of the person) and resolves when the model is ready. */
  download(size: VoiceModelSize): Promise<void>;
  /** Deletes the model, stopping its download if it is running. */
  remove(size: VoiceModelSize): Promise<void>;
}

/** Polls that fail one after the other before the page gives up on a download it is following. */
const MAX_POLL_FAILURES = 5;

interface Waiter {
  size: VoiceModelSize;
  resolve: () => void;
  reject: (error: VoiceDownloadError) => void;
}

export function createVoiceModels(api: VoiceApi): VoiceModels {
  let current: VoiceStatusResponse | null = null;
  const listeners = new Set<() => void>();
  const waiters = new Set<Waiter>();
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let pollFailures = 0;

  const statusOf = (size: VoiceModelSize): VoiceModelStatus | undefined =>
    current?.models.find((model) => model.size === size);

  function settleWaiters(): void {
    for (const waiter of [...waiters]) {
      const model = statusOf(waiter.size);
      if (model?.state === 'ready') waiter.resolve();
      else if (model?.state === 'error') waiter.reject(new VoiceDownloadError(model.error ?? 'network'));
      else if (model === undefined || model.state === 'missing') waiter.reject(new VoiceDownloadError('cancelled'));
      else continue;
      waiters.delete(waiter);
    }
  }

  function apply(next: VoiceStatusResponse | null): void {
    current = next;
    settleWaiters();
    for (const listener of [...listeners]) listener();
  }

  const isDownloading = (): boolean => current?.models.some((model) => model.state === 'downloading') === true;

  function schedulePoll(): void {
    if (pollTimer !== undefined || !isDownloading()) return;
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      void poll();
    }, DOWNLOAD_POLL_MS);
  }

  async function poll(): Promise<void> {
    try {
      apply(await api.status());
      pollFailures = 0;
    } catch {
      pollFailures++;
      if (pollFailures >= MAX_POLL_FAILURES) {
        pollFailures = 0;
        for (const waiter of [...waiters]) waiter.reject(new VoiceDownloadError('unreachable'));
        waiters.clear();
        apply(null);
        return;
      }
    }
    schedulePoll();
  }

  return {
    current: () => current,
    statusOf,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async refresh() {
      try {
        apply(await api.status());
      } catch {
        apply(null);
      }
      schedulePoll();
    },
    async download(size) {
      let started: VoiceStatusResponse;
      try {
        started = await api.startDownload(size);
      } catch (error) {
        throw new VoiceDownloadError(
          error instanceof VoiceApiError && error.kind !== 'failed' ? error.kind : 'network',
        );
      }
      const finished = new Promise<void>((resolve, reject) => waiters.add({ size, resolve, reject }));
      apply(started);
      schedulePoll();
      return finished;
    },
    async remove(size) {
      apply(await api.remove(size));
    },
  };
}
