import { describe, expect, it } from 'vitest';
import { MAX_ROLES, addRole, removeRole, validRole } from './roles';

const role = (id: string) => ({ id, name: id, instructions: 'do' });

describe('roles', () => {
  it('adds a role at the top without changing the list it got', () => {
    // Arrange
    const list = [role('a')];

    // Act
    const next = addRole(list, role('b'));

    // Assert
    expect(next.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(list).toHaveLength(1);
  });

  it('replaces a role with the same name instead of keeping two', () => {
    // Arrange
    const list = [{ id: 'a', name: 'Revisor', instructions: 'old' }];

    // Act
    const next = addRole(list, { id: 'b', name: ' revisor ', instructions: 'new' });

    // Assert
    expect(next).toEqual([{ id: 'b', name: 'revisor', instructions: 'new' }]);
  });

  it('never holds more than the limit', () => {
    // Arrange
    const list = Array.from({ length: MAX_ROLES }, (_, index) => role(String(index)));

    // Act
    const next = addRole(list, role('new'));

    // Assert
    expect(next).toHaveLength(MAX_ROLES);
    expect(next[0]?.id).toBe('new');
  });

  it('removes a role by id', () => {
    expect(removeRole([role('a'), role('b')], 'a').map((entry) => entry.id)).toEqual(['b']);
  });

  it('needs a name and instructions, within what a hire accepts', () => {
    expect(validRole('Revisor', 'Revise')).toBe(true);
    expect(validRole('  ', 'Revise')).toBe(false);
    expect(validRole('Revisor', '  ')).toBe(false);
    expect(validRole('x'.repeat(49), 'Revise')).toBe(false);
    expect(validRole('Revisor', 'x'.repeat(8001))).toBe(false);
  });
});
