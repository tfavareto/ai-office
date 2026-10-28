// Keyboard navigation between terminals: the arrow keys move the focus to the nearest terminal in that direction.
import { rectCenter, type Rect } from './geometry';

export type Direction = 'left' | 'right' | 'up' | 'down';

export interface SpatialNode {
  id: string;
  rect: Rect;
}

/** How much a sideways offset counts against a candidate, compared to the distance along the direction. */
const CROSS_WEIGHT = 2;

/** The terminal nearest to `fromId` in `direction`, or null when there is none that way. */
export function neighbor(nodes: readonly SpatialNode[], fromId: string, direction: Direction): string | null {
  const from = nodes.find((node) => node.id === fromId);
  if (from === undefined) return null;
  const origin = rectCenter(from.rect);
  let best: { id: string; score: number } | null = null;
  for (const node of nodes) {
    if (node.id === fromId) continue;
    const center = rectCenter(node.rect);
    const dx = center.x - origin.x;
    const dy = center.y - origin.y;
    const along = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
    if (along <= 0) continue;
    const across = Math.abs(direction === 'left' || direction === 'right' ? dy : dx);
    const score = along + CROSS_WEIGHT * across;
    if (best === null || score < best.score || (score === best.score && node.id < best.id))
      best = { id: node.id, score };
  }
  return best?.id ?? null;
}

export function directionOfKey(key: string): Direction | null {
  switch (key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    default:
      return null;
  }
}
