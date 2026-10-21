import { describe, expect, it } from 'vitest';
import { fitUsageCards, type UsageFitInput } from './usage-fit';

const base: UsageFitInput = { available: 600, gap: 8, full: [140, 170, 180], compact: [100, 110, 110], more: 36 };

describe('fitUsageCards', () => {
  it('keeps the full cards when they all fit', () => {
    expect(fitUsageCards({ ...base, available: 506 })).toEqual({ compact: false, visible: 3, showMore: false });
  });

  it('switches to compact cards when the full ones do not fit', () => {
    expect(fitUsageCards({ ...base, available: 505 })).toEqual({ compact: true, visible: 3, showMore: false });
    expect(fitUsageCards({ ...base, available: 336 })).toEqual({ compact: true, visible: 3, showMore: false });
  });

  it('shows as many compact cards as fit plus the overflow button', () => {
    expect(fitUsageCards({ ...base, available: 335 })).toEqual({ compact: true, visible: 2, showMore: true });
    expect(fitUsageCards({ ...base, available: 262 })).toEqual({ compact: true, visible: 2, showMore: true });
    expect(fitUsageCards({ ...base, available: 261 })).toEqual({ compact: true, visible: 1, showMore: true });
    expect(fitUsageCards({ ...base, available: 144 })).toEqual({ compact: true, visible: 1, showMore: true });
  });

  it('shows only the overflow button when not even one card fits next to it', () => {
    expect(fitUsageCards({ ...base, available: 143 })).toEqual({ compact: true, visible: 0, showMore: true });
    expect(fitUsageCards({ ...base, available: 36 })).toEqual({ compact: true, visible: 0, showMore: true });
  });

  it('shows nothing when not even the overflow button fits', () => {
    expect(fitUsageCards({ ...base, available: 35 })).toEqual({ compact: true, visible: 0, showMore: false });
    expect(fitUsageCards({ ...base, available: 0 })).toEqual({ compact: true, visible: 0, showMore: false });
  });

  it('handles a single account and no account', () => {
    expect(fitUsageCards({ available: 200, gap: 8, full: [140], compact: [100], more: 36 })).toEqual({
      compact: false,
      visible: 1,
      showMore: false,
    });
    expect(fitUsageCards({ available: 120, gap: 8, full: [140], compact: [100], more: 36 })).toEqual({
      compact: true,
      visible: 1,
      showMore: false,
    });
    expect(fitUsageCards({ available: 50, gap: 8, full: [140], compact: [100], more: 36 })).toEqual({
      compact: true,
      visible: 0,
      showMore: true,
    });
    expect(fitUsageCards({ ...base, full: [], compact: [] })).toEqual({ compact: false, visible: 0, showMore: false });
  });
});
