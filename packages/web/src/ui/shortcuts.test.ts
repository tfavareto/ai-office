import { describe, expect, it } from 'vitest';
import { resolveShortcut } from './shortcuts';

const key = (name: string, modifiers: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
});

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

  it('maps R to the day report, but not while typing or with modifiers', () => {
    expect(resolveShortcut(key('r'), false, false)).toBe('report');
    expect(resolveShortcut(key('R'), false, false)).toBe('report');
    expect(resolveShortcut(key('r'), true, false)).toBeNull();
    expect(resolveShortcut(key('r', { metaKey: true }), false, false)).toBeNull();
  });

  it('maps C to the achievements, but not while typing or when copying', () => {
    expect(resolveShortcut(key('c'), false, false)).toBe('achievements');
    expect(resolveShortcut(key('C'), false, false)).toBe('achievements');
    expect(resolveShortcut(key('c'), true, false)).toBeNull();
    expect(resolveShortcut(key('c', { metaKey: true }), false, false)).toBeNull();
    expect(resolveShortcut(key('c', { ctrlKey: true }), false, false)).toBeNull();
  });

  it('keeps the other shortcuts', () => {
    expect(resolveShortcut(key('n'), false, false)).toBe('message');
    expect(resolveShortcut(key('Escape'), true, false)).toBe('escape');
    expect(resolveShortcut(key('f', { ctrlKey: true }), false, true)).toBe('find');
  });

  it('maps L to the time-lapse, but not while typing', () => {
    expect(resolveShortcut(key('l'), false, false)).toBe('replay');
    expect(resolveShortcut(key('L'), false, false)).toBe('replay');
    expect(resolveShortcut(key('l'), true, false)).toBeNull();
  });
});

describe('resolveShortcut during a time-lapse', () => {
  const press = (name: string, shiftKey = false, replay = true, editing = false) =>
    resolveShortcut({ ...key(name), shiftKey }, editing, false, replay);

  it('drives the playback with Space and the arrows, Shift for the big skip', () => {
    expect(press(' ')).toBe('replayPlay');
    expect(press('ArrowLeft')).toBe('replayBack');
    expect(press('ArrowRight')).toBe('replayForward');
    expect(press('ArrowLeft', true)).toBe('replayBackBig');
    expect(press('ArrowRight', true)).toBe('replayForwardBig');
  });

  it('leaves those keys alone when no time-lapse has the keyboard, and while typing', () => {
    expect(press(' ', false, false)).toBeNull();
    expect(press('ArrowRight', false, false)).toBeNull();
    expect(press(' ', false, true, true)).toBeNull();
  });

  it('keeps the other shortcuts, Esc included', () => {
    expect(press('l')).toBe('replay');
    expect(press('Escape')).toBe('escape');
  });
});
