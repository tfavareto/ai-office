import { describe, expect, test } from 'vitest';
import type { Agent, Project } from '@ai-office/shared';
import { watchedRooms } from './rooms';

const project = (id: string): Project => ({ id, name: id, path: `/work/${id}`, seed: 1, order: 0 });
const agent = (projectId: string, status: Agent['status'], demo = false): Agent => ({ projectId, status, ...(demo ? { demo: true } : {}) }) as Agent;

describe('watchedRooms', () => {
  test('follows real rooms and marks the ones with working or waiting agents as active', () => {
    // Arrange
    const projects = [project('a'), project('b'), project('c')];
    const agents = [agent('a', 'working'), agent('b', 'idle'), agent('c', 'waiting')];
    // Act
    const rooms = watchedRooms(projects, agents, new Set());
    // Assert
    expect(rooms).toEqual([
      { id: 'a', path: '/work/a', active: true },
      { id: 'b', path: '/work/b', active: false },
      { id: 'c', path: '/work/c', active: true },
    ]);
  });

  test('leaves out the rooms of the demo simulator and does not count demo agents', () => {
    // Arrange
    const projects = [project('real'), project('fake')];
    const agents = [agent('real', 'idle'), agent('real', 'working', true), agent('fake', 'working', true)];
    // Act
    const rooms = watchedRooms(projects, agents, new Set(['fake']));
    // Assert
    expect(rooms).toEqual([{ id: 'real', path: '/work/real', active: false }]);
  });
});
