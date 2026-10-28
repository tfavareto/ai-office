import { describe, expect, it } from 'vitest';
import { directionOfKey, neighbor, type SpatialNode } from './spatial';

const box = (id: string, x: number, y: number): SpatialNode => ({ id, rect: { x, y, width: 100, height: 100 } });
const NODES = [
  box('center', 0, 0),
  box('right', 300, 10),
  box('far-right', 700, 0),
  box('below', 20, 300),
  box('left', -300, -20),
];

describe('neighbor', () => {
  it('picks the nearest terminal in the direction asked', () => {
    expect(neighbor(NODES, 'center', 'right')).toBe('right');
    expect(neighbor(NODES, 'right', 'right')).toBe('far-right');
    expect(neighbor(NODES, 'center', 'down')).toBe('below');
    expect(neighbor(NODES, 'center', 'left')).toBe('left');
  });

  it('prefers the one in line over a closer one off to the side', () => {
    const nodes = [box('from', 0, 0), box('aligned', 600, 0), box('aside', 300, 500)];
    expect(neighbor(nodes, 'from', 'right')).toBe('aligned');
  });

  it('returns null when nothing lies that way or the origin is unknown', () => {
    expect(neighbor(NODES, 'below', 'down')).toBeNull();
    expect(neighbor(NODES, 'missing', 'right')).toBeNull();
  });

  it('maps arrow keys to directions', () => {
    expect(directionOfKey('ArrowUp')).toBe('up');
    expect(directionOfKey('ArrowLeft')).toBe('left');
    expect(directionOfKey('a')).toBeNull();
  });
});
