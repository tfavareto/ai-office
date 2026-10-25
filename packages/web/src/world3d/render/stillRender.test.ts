import { describe, expect, it } from 'vitest';
import { flipRows } from './stillRender';

describe('flipRows', () => {
  it('puts the last row first and makes every pixel opaque', () => {
    // Arrange: two rows of two pixels, bottom row first as the GPU returns them
    const bottom = [1, 2, 3, 0, 4, 5, 6, 0];
    const top = [7, 8, 9, 0, 10, 11, 12, 0];

    // Act
    const flipped = flipRows(new Uint8Array([...bottom, ...top]), 2, 2);

    // Assert
    expect([...flipped]).toEqual([7, 8, 9, 255, 10, 11, 12, 255, 1, 2, 3, 255, 4, 5, 6, 255]);
  });
});
