import type { TranscriptPage } from '@ai-office/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NUDGE_GAP_MS, RETRY_MS, TranscriptFeed, type FeedHost, type FeedSource } from './transcript-feed';

function page(next: number, open = true): TranscriptPage {
  return { entries: [{ kind: 'assistant', at: next, text: `entry ${next}` }], next, open };
}

interface FakeSource extends FeedSource {
  calls: (number | undefined)[];
  fail: boolean;
}

function fakeSource(): FakeSource {
  const source: FakeSource = {
    calls: [],
    fail: false,
    page: async (after) => {
      source.calls.push(after);
      if (source.fail) throw new Error('offline');
      return page((after ?? 0) + 1);
    },
  };
  return source;
}

function fakeHost(): FeedHost & { hide(hidden: boolean): void } {
  let hidden = false;
  const listeners = new Set<() => void>();
  return {
    now: () => Date.now(),
    hidden: () => hidden,
    onVisible: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    hide: (value) => {
      hidden = value;
      if (!value) for (const listener of [...listeners]) listener();
    },
  };
}

describe('TranscriptFeed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('loads the newest page first, then polls from the cursor', async () => {
    // Arrange
    const source = fakeSource();
    const feed = new TranscriptFeed(source, () => undefined, fakeHost());

    // Act
    feed.run(1000);
    await vi.advanceTimersByTimeAsync(1000);

    // Assert
    expect(source.calls).toEqual([undefined, 1]);
    expect(feed.status).toBe('ready');
  });

  it('keeps its timer when it is told the same interval again', async () => {
    // Arrange
    const source = fakeSource();
    const feed = new TranscriptFeed(source, () => undefined, fakeHost());
    feed.run(1000);
    await vi.advanceTimersByTimeAsync(0);

    // Act: the policy asks again every 120 ms; the poll must still happen on time.
    for (let step = 0; step < 8; step++) {
      await vi.advanceTimersByTimeAsync(120);
      feed.run(1000);
    }
    await vi.advanceTimersByTimeAsync(100);

    // Assert
    expect(source.calls).toEqual([undefined, 1]);
  });

  it('fetches at once when nudged, but not twice in a burst', async () => {
    // Arrange
    const source = fakeSource();
    const feed = new TranscriptFeed(source, () => undefined, fakeHost());
    feed.run(1000);
    await vi.advanceTimersByTimeAsync(NUDGE_GAP_MS);

    // Act
    feed.nudge();
    feed.nudge();
    await vi.advanceTimersByTimeAsync(0);

    // Assert
    expect(source.calls).toEqual([undefined, 1]);
  });

  it('starts again from the newest page when it was stopped during the first load', async () => {
    // Arrange
    const source = fakeSource();
    const feed = new TranscriptFeed(source, () => undefined, fakeHost());
    feed.run(1000);

    // Act
    feed.stop();
    await vi.advanceTimersByTimeAsync(0);
    feed.run(1000);
    await vi.advanceTimersByTimeAsync(0);

    // Assert
    expect(feed.status).toBe('ready');
    expect(source.calls).toEqual([undefined, undefined]);
  });

  it('waits for the backoff after a failed first load, however often it is asked', async () => {
    // Arrange
    const source = fakeSource();
    source.fail = true;
    const feed = new TranscriptFeed(source, () => undefined, fakeHost());
    feed.run(1000);
    await vi.advanceTimersByTimeAsync(0);

    // Act
    for (let step = 0; step < 10; step++) {
      feed.run(1000);
      await vi.advanceTimersByTimeAsync(RETRY_MS / 20);
    }
    const beforeBackoff = source.calls.length;
    source.fail = false;
    await vi.advanceTimersByTimeAsync(RETRY_MS);

    // Assert
    expect(beforeBackoff).toBe(1);
    expect(feed.status).toBe('ready');
  });

  it('sleeps while the page is hidden and continues when it shows again', async () => {
    // Arrange
    const source = fakeSource();
    const host = fakeHost();
    const feed = new TranscriptFeed(source, () => undefined, host);
    feed.run(1000);
    await vi.advanceTimersByTimeAsync(0);

    // Act
    host.hide(true);
    await vi.advanceTimersByTimeAsync(5000);
    const whileHidden = source.calls.length;
    host.hide(false);
    await vi.advanceTimersByTimeAsync(0);

    // Assert
    expect(whileHidden).toBe(1);
    expect(source.calls).toEqual([undefined, 1]);
  });

  it('stops polling a session that ended', async () => {
    // Arrange
    const source: FeedSource & { calls: number } = {
      calls: 0,
      page: async () => {
        source.calls++;
        return page(1, false);
      },
    };
    const feed = new TranscriptFeed(source, () => undefined, fakeHost());

    // Act
    feed.run(1000);
    await vi.advanceTimersByTimeAsync(5000);

    // Assert
    expect(source.calls).toBe(1);
    expect(feed.running).toBe(false);
  });
});
