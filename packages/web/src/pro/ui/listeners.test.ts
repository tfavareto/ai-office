import { describe, expect, it } from 'vitest';
import { Listeners } from './listeners';

describe('Listeners', () => {
  it('stops every listener it added from reacting once removed', () => {
    // Arrange
    const target = new EventTarget();
    const listeners = new Listeners();
    const heard: string[] = [];
    listeners.on(target, 'keydown', () => heard.push('keydown'));
    listeners.on(target, 'blur', () => heard.push('blur'));
    target.dispatchEvent(new Event('keydown'));

    // Act
    listeners.removeAll();
    target.dispatchEvent(new Event('keydown'));
    target.dispatchEvent(new Event('blur'));

    // Assert
    expect(heard).toEqual(['keydown']);
    expect(listeners.size).toBe(0);
  });
});
