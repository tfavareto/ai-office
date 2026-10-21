import { describe, expect, it } from 'vitest';
import { resolveInboxKey, type InboxKeyEvent } from './inbox-keys';

const key = (name: string, over: Partial<InboxKeyEvent> = {}): InboxKeyEvent => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});
const FREE = { editing: false, onControl: false };

describe('resolveInboxKey', () => {
  it.each([
    ['j', 'next'],
    ['k', 'previous'],
    ['ArrowDown', 'next'],
    ['ArrowUp', 'previous'],
    [' ', 'toggle'],
    ['a', 'approve'],
    ['d', 'deny'],
    ['e', 'seen'],
    ['Enter', 'open'],
  ] as const)('maps %s to %s', (name, action) => {
    expect(resolveInboxKey(key(name), FREE)).toBe(action);
  });

  it('maps Shift+A to approve-and-remember, and ignores other shifted letters', () => {
    expect(resolveInboxKey(key('A', { shiftKey: true }), FREE)).toBe('remember');
    expect(resolveInboxKey(key('D', { shiftKey: true }), FREE)).toBeNull();
    expect(resolveInboxKey(key('J', { shiftKey: true }), FREE)).toBeNull();
  });

  it('treats caps lock like the plain letter', () => {
    expect(resolveInboxKey(key('A'), FREE)).toBe('approve');
  });

  it('stays out of the way while typing', () => {
    expect(resolveInboxKey(key('a'), { editing: true, onControl: false })).toBeNull();
    expect(resolveInboxKey(key('ArrowDown'), { editing: true, onControl: false })).toBeNull();
  });

  it('leaves Space and Enter to a focused button', () => {
    expect(resolveInboxKey(key(' '), { editing: false, onControl: true })).toBeNull();
    expect(resolveInboxKey(key('Enter'), { editing: false, onControl: true })).toBeNull();
    expect(resolveInboxKey(key('a'), { editing: false, onControl: true })).toBe('approve');
  });

  it('ignores shortcuts with Ctrl, Cmd or Alt, and unknown keys', () => {
    expect(resolveInboxKey(key('a', { metaKey: true }), FREE)).toBeNull();
    expect(resolveInboxKey(key('d', { ctrlKey: true }), FREE)).toBeNull();
    expect(resolveInboxKey(key('j', { altKey: true }), FREE)).toBeNull();
    expect(resolveInboxKey(key('z'), FREE)).toBeNull();
    expect(resolveInboxKey(key('Tab'), FREE)).toBeNull();
  });
});
