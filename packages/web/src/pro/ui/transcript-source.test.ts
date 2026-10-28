import type { TranscriptEntry } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { demoPage } from './transcript-source';

const entries: TranscriptEntry[] = [
  { kind: 'user', at: 1, text: 'go' },
  { kind: 'tool', at: 2, id: 't1', name: 'Read', summary: '', result: '' },
  { kind: 'tool', at: 3, id: 't2', name: 'Bash', summary: '' },
];

describe('demoPage', () => {
  it('keeps the cursor on a call still waiting for its result, as the server does', () => {
    // Arrange, Act
    const page = demoPage(entries, 0, true);

    // Assert
    expect(page.next).toBe(2);
    expect(page.entries).toHaveLength(3);
  });

  it('continues from the cursor and moves past the end when nothing waits', () => {
    // Arrange
    const done = entries.slice(0, 2);

    // Act
    const page = demoPage(done, 1, false);

    // Assert
    expect(page).toEqual({ entries: [done[1]], next: 2, open: false });
  });
});
