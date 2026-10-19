import { describe, expect, test } from 'vitest';
import { ACCOUNT_COLORS, accountColor, hslToHex, projectAccent } from './colors';

describe('colors', () => {
  test('account colors wrap around the palette', () => {
    expect(accountColor(0)).toBe(ACCOUNT_COLORS[0]);
    expect(accountColor(ACCOUNT_COLORS.length)).toBe(ACCOUNT_COLORS[0]);
    expect(accountColor(-1)).toBe(ACCOUNT_COLORS[ACCOUNT_COLORS.length - 1]);
  });

  test('converts HSL to hex', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#ff0000');
    expect(hslToHex(120, 1, 0.5)).toBe('#00ff00');
    expect(hslToHex(240, 1, 0.5)).toBe('#0000ff');
  });

  test('project accent is a stable hex color per seed', () => {
    expect(projectAccent(1234)).toMatch(/^#[0-9a-f]{6}$/);
    expect(projectAccent(1234)).toBe(projectAccent(1234));
    expect(projectAccent(1)).not.toBe(projectAccent(180));
  });
});
