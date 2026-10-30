import { describe, expect, it } from 'vitest';
import { AUTO_FIT_OFF, AUTO_FIT_START, fittedTo, shouldRefit } from './auto-fit';

const BOUNDS = { x: 0, y: 0, width: 2000, height: 1000 };

describe('auto fit', () => {
  it('fits the first time there is something to show', () => {
    expect(shouldRefit(AUTO_FIT_START, BOUNDS)).toBe(true);
    expect(shouldRefit(AUTO_FIT_START, null)).toBe(false);
  });

  it('fits again when the content grows past what was fitted', () => {
    // Arrange
    const state = fittedTo(BOUNDS);

    // Act
    const taller = shouldRefit(state, { ...BOUNDS, height: 1400 });
    const wider = shouldRefit(state, { ...BOUNDS, x: -10, width: 2010 });

    // Assert
    expect(taller).toBe(true);
    expect(wider).toBe(true);
  });

  it('leaves the camera alone while the content stays inside what was fitted', () => {
    const state = fittedTo(BOUNDS);
    expect(shouldRefit(state, BOUNDS)).toBe(false);
    expect(shouldRefit(state, { x: 100, y: 0, width: 1500, height: 900 })).toBe(false);
  });

  it('never fits by itself once the user moved the camera', () => {
    expect(shouldRefit(AUTO_FIT_OFF, { ...BOUNDS, height: 9000 })).toBe(false);
  });
});
