import { describe, expect, it } from 'vitest';
import { TILE } from '../../layout/constants';
import { layoutProjectRoom } from '../../layout/project';
import { SCREEN_H, SCREEN_W } from '../runtime/screens';
import { DESK_MONITORS, DESK_W, FRAME_H, FRAME_TOP, FRAME_W, deskScreenRects } from './deskLayout';
import { DESK_SCREENS } from './furnOffice';

describe('desk monitor layout', () => {
  it('has exactly two monitors per workstation', () => {
    expect(DESK_MONITORS).toBe(2);
    expect(deskScreenRects()).toHaveLength(2);
    expect(DESK_SCREENS).toHaveLength(2);
  });

  it('centres the pair on the desk centre line', () => {
    const [a, b] = deskScreenRects();
    const left = a.frameX;
    const right = b.frameX + FRAME_W;
    expect(left + right).toBe(DESK_W);
    expect(b.frameX - (a.frameX + FRAME_W)).toBeGreaterThan(0);
  });

  it('keeps the frames inside the desk width and rising above its top edge', () => {
    for (const m of deskScreenRects()) {
      expect(m.frameX).toBeGreaterThanOrEqual(0);
      expect(m.frameX + FRAME_W).toBeLessThanOrEqual(DESK_W);
      expect(m.frameY).toBe(FRAME_TOP);
      expect(m.frameY + FRAME_H).toBeLessThanOrEqual(1);
      expect(m.x).toBe(m.frameX + 1);
      expect(m.x + SCREEN_W).toBeLessThan(m.frameX + FRAME_W);
      expect(m.y + SCREEN_H).toBeLessThan(m.frameY + FRAME_H);
    }
  });

  it('is centred on the seat of every project-room desk', () => {
    const room = layoutProjectRoom({ id: 'p', name: 'p', seed: 7, slot: 0 });
    const desks = room.furniture.filter((f) => f.kind === 'desk');
    const seats = room.spots.filter((s) => s.kind === 'desk');
    expect(desks).toHaveLength(6);
    for (const seat of seats) {
      const desk = desks.find((d) => d.variant === seat.deskIndex)!;
      const [a, b] = deskScreenRects(desk.w * TILE);
      const centre = (a.frameX + b.frameX + FRAME_W) / 2;
      expect(desk.x * TILE + centre).toBe(seat.x * TILE);
      expect(desk.x).toBeGreaterThanOrEqual(room.rect.x);
      expect(desk.x + desk.w).toBeLessThanOrEqual(room.rect.x + room.rect.w);
    }
  });
});
