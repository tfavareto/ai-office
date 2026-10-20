import { describe, expect, it } from 'vitest';
import { resolveShortcut } from './shortcuts';

const key = (name: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({ key: name, ctrlKey: false, metaKey: false, altKey: false, ...modifiers });

describe('resolveShortcut', () => {
  it('maps H to hiring an agent, in either case', () => {
    expect(resolveShortcut(key('h'), false, false)).toBe('hire');
    expect(resolveShortcut(key('H'), false, false)).toBe('hire');
  });

  it('leaves H alone while typing and with modifiers', () => {
    expect(resolveShortcut(key('h'), true, false)).toBeNull();
    expect(resolveShortcut(key('h', { metaKey: true }), false, false)).toBeNull();
    expect(resolveShortcut(key('h', { altKey: true }), false, false)).toBeNull();
  });

  it('keeps the other shortcuts', () => {
    expect(resolveShortcut(key('n'), false, false)).toBe('message');
    expect(resolveShortcut(key('Escape'), true, false)).toBe('escape');
    expect(resolveShortcut(key('f', { ctrlKey: true }), false, true)).toBe('find');
  });
});
