import { describe, expect, test } from 'vitest';
import { SerialWriter } from './serial-writer';

describe('SerialWriter', () => {
  test('writes in order and flush waits for all of them', async () => {
    // Arrange
    const written: number[] = [];
    let state = 1;
    const writer = new SerialWriter(
      async () => {
        const value = state;
        await new Promise((resolve) => setTimeout(resolve, value === 1 ? 10 : 0));
        written.push(value);
      },
      () => undefined,
    );

    // Act
    writer.request();
    await Promise.resolve();
    state = 2;
    writer.request();
    await writer.flush();

    // Assert
    expect(written.at(-1)).toBe(2);
    expect([...written].sort()).toEqual(written);
  });

  test('a failed write is reported and does not stop the next', async () => {
    // Arrange
    const errors: unknown[] = [];
    let calls = 0;
    const writer = new SerialWriter(
      () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('disk')) : Promise.resolve();
      },
      (error) => errors.push(error),
    );

    // Act
    writer.request();
    writer.request();
    await writer.flush();

    // Assert
    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
  });
});
