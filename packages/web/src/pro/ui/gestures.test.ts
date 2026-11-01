import { describe, expect, it } from 'vitest';
import { isMouseWheel, wheelDelta } from './gestures';

describe('isMouseWheel', () => {
  it('recognizes the whole notches of a mouse', () => {
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 100 })).toBe(true);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: -120 })).toBe(true);
    expect(isMouseWheel({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe(true);
  });

  it('leaves the small, fractional or sideways deltas of a trackpad to panning', () => {
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 7 })).toBe(false);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 12.5 })).toBe(false);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 4, deltaY: 100 })).toBe(false);
    expect(isMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 0 })).toBe(false);
  });
});

describe('wheelDelta', () => {
  it('converts lines and pages to pixels', () => {
    expect(wheelDelta({ deltaMode: 0, deltaY: 40 })).toBe(40);
    expect(wheelDelta({ deltaMode: 1, deltaY: 3 })).toBe(48);
    expect(wheelDelta({ deltaMode: 2, deltaY: 1 })).toBe(400);
  });
});
