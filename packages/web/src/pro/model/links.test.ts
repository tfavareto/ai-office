import { describe, expect, it } from 'vitest';
import { rectBottom, rectRight, rectsOverlap, type Point, type Rect } from './geometry';
import { linkPath, linkState } from './links';
import { orchestratorRect, slotRect } from './slots';

describe('linkState', () => {
  it('flows while the subagent works and turns amber when it waits for the user', () => {
    expect(linkState({ status: 'working' }, false)).toBe('flowing');
    expect(linkState({ status: 'waiting' }, false)).toBe('waiting');
    expect(linkState({ status: 'idle' }, false)).toBe('idle');
  });

  it('dims once finished, whatever the last known status was', () => {
    expect(linkState({ status: 'done' }, false)).toBe('done');
    expect(linkState({ status: 'offline' }, false)).toBe('done');
    expect(linkState({ status: 'working' }, true)).toBe('done');
  });
});

/** The corners of a path made of M, H and V commands. */
function corners(d: string): Point[] {
  const points: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  for (const [, command, args] of d.matchAll(/([MHV])([^MHV]+)/g)) {
    const values = (args ?? '').trim().split(/\s+/).map(Number);
    if (command === 'M') current = { x: values[0] ?? 0, y: values[1] ?? 0 };
    else if (command === 'H') current = { ...current, x: values[0] ?? 0 };
    else current = { ...current, y: values[0] ?? 0 };
    points.push(current);
  }
  return points;
}

/** Whether a segment between two corners passes through a rectangle (shrunk by 1 so touching an edge is fine). */
function crosses(a: Point, b: Point, rect: Rect): boolean {
  const segment = {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.max(0.01, Math.abs(a.x - b.x)),
    height: Math.max(0.01, Math.abs(a.y - b.y)),
  };
  return rectsOverlap(segment, { x: rect.x + 1, y: rect.y + 1, width: rect.width - 2, height: rect.height - 2 });
}

describe('linkPath', () => {
  const center = { x: 0, y: 0 };
  const orchestrator = orchestratorRect(center);

  it('drops straight down to a subagent right under the orchestrator', () => {
    // Arrange
    const sub = slotRect(center, 0);

    // Act
    const link = linkPath(orchestrator, sub);

    // Assert
    expect(link.start).toEqual({ x: 0, y: rectBottom(orchestrator) });
    expect(link.end).toEqual({ x: 0, y: sub.y });
    expect(link.d).toBe(`M0 ${rectBottom(orchestrator)}V${sub.y}`);
  });

  it('leaves the bottom of the orchestrator and enters the top of a subagent beside the middle', () => {
    const left = slotRect(center, 1);
    const link = linkPath(orchestrator, left);
    expect(link.start.y).toBe(rectBottom(orchestrator));
    expect(link.start.x).toBeGreaterThan(orchestrator.x);
    expect(link.start.x).toBeLessThan(rectRight(orchestrator));
    expect(link.end).toEqual({ x: left.x + left.width / 2, y: left.y });
    expect(corners(link.d)).toHaveLength(4);
  });

  it('never crosses a terminal of the rows above on the way to a lower row', () => {
    // Arrange: three full rows.
    const subs = Array.from({ length: 9 }, (_, slot) => slotRect(center, slot));

    // Act and assert
    subs.forEach((target, index) => {
      const points = corners(linkPath(orchestrator, target).d);
      for (let i = 1; i < points.length; i++)
        for (const [other, rect] of subs.entries()) {
          if (other === index) continue;
          expect(crosses(points[i - 1] as Point, points[i] as Point, rect), `slot ${index} crosses ${other}`).toBe(
            false,
          );
        }
    });
  });

  it('goes out of the side for a terminal dragged beside the orchestrator', () => {
    const beside = { x: rectRight(orchestrator) + 400, y: -100, width: 300, height: 210 };
    const link = linkPath(orchestrator, beside);
    expect(link.start.x).toBe(rectRight(orchestrator));
    expect(link.end.x).toBe(beside.x);
    const toTheLeft = linkPath(orchestrator, { ...beside, x: orchestrator.x - 900 });
    expect(toTheLeft.start.x).toBe(orchestrator.x);
  });
});
