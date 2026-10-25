import { describe, expect, it, vi } from 'vitest';
import { canCopyImage, cardFilename, copyImage } from './export';

const png = new Blob(['x'], { type: 'image/png' });

class FakeItem {
  constructor(readonly data: Record<string, Blob>) {}
}

describe('cardFilename', () => {
  it('names the file after the day', () => {
    expect(cardFilename('2026-10-25')).toBe('ai-office-2026-10-25.png');
  });
});

describe('canCopyImage', () => {
  it('needs both the async clipboard and ClipboardItem', () => {
    expect(canCopyImage({ write: async () => undefined }, FakeItem)).toBe(true);
    expect(canCopyImage({ write: async () => undefined }, undefined)).toBe(false);
    expect(canCopyImage({}, FakeItem)).toBe(false);
    expect(canCopyImage(undefined, FakeItem)).toBe(false);
  });
});

describe('copyImage', () => {
  it('puts the PNG on the clipboard', async () => {
    const write = vi.fn(async () => undefined);

    const result = await copyImage(png, { write }, FakeItem);

    expect(result).toBe('copied');
    const item = (write.mock.calls[0] as unknown as [FakeItem[]])[0][0];
    expect(item?.data['image/png']).toBe(png);
  });

  it('says so when the browser cannot copy images', async () => {
    expect(await copyImage(png, {}, FakeItem)).toBe('unsupported');
    expect(await copyImage(png, { write: async () => undefined }, undefined)).toBe('unsupported');
  });

  it('says so when the browser refuses', async () => {
    const write = vi.fn(async () => {
      throw new Error('denied');
    });

    expect(await copyImage(png, { write }, FakeItem)).toBe('failed');
  });
});
