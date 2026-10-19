import { describe, expect, it } from 'vitest';
import { Camera, fitZoom, zoomLevels } from './camera';

const view = { width: 1440, height: 900, insets: { top: 56, right: 380, bottom: 0, left: 320 } };

function cam(dpr = 2): Camera {
  const c = new Camera();
  c.dpr = dpr;
  c.view = view;
  return c;
}

describe('zoom levels', () => {
  it('keeps the device scale a whole number', () => {
    for (const dpr of [1, 2, 3]) {
      for (const z of zoomLevels(dpr).filter((l) => l !== 0.5)) expect(Number.isInteger(z * dpr)).toBe(true);
    }
  });

  it('offers integer zooms 1-6 on a 1x display and half steps on retina', () => {
    expect(zoomLevels(1)).toEqual([0.5, 1, 2, 3, 4, 5, 6]);
    expect(zoomLevels(2)).toContain(1.5);
  });
});

describe('camera math', () => {
  it('round-trips screen and world coordinates', () => {
    const c = cam();
    c.cx = 300;
    c.cy = 120;
    c.zoom = 3;
    const s = c.worldToScreen(412, 99);
    const w = c.screenToWorld(s.x, s.y);
    expect(w.x).toBeCloseTo(412);
    expect(w.y).toBeCloseTo(99);
  });

  it('anchors wheel zoom at the cursor', () => {
    const c = cam();
    c.zoom = 2;
    c.cx = 500;
    c.cy = 200;
    const before = c.screenToWorld(900, 400);
    c.zoomAt(1, 900, 400);
    expect(c.zoom).toBe(3);
    const after = c.screenToWorld(900, 400);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps zoom to the available range', () => {
    const c = cam();
    c.zoom = 6;
    c.zoomAt(1, 0, 0);
    expect(c.zoom).toBe(6);
    c.zoom = 0.5;
    c.zoomAt(-1, 0, 0);
    expect(c.zoom).toBe(0.5);
  });

  it('centres a focus point in the free area, not the full window', () => {
    const c = cam();
    c.zoom = 4;
    c.focus(640, 240, true);
    const s = c.worldToScreen(640, 240);
    expect(s.x).toBeCloseTo(320 + (1440 - 320 - 380) / 2);
    expect(s.y).toBeCloseTo(56 + (900 - 56) / 2);
  });

  it('fits the overview inside the insets with the largest fitting level', () => {
    const bounds = { x: 0, y: 0, w: 700, h: 400 };
    const z = fitZoom(bounds, view, zoomLevels(2));
    expect(z).toBe(1);
    const big = { x: 0, y: 0, w: 1400, h: 400 };
    expect(fitZoom(big, view, zoomLevels(2))).toBe(0.5);
  });

  it('eases toward its target and settles', () => {
    const c = cam();
    c.cx = 0;
    c.cy = 0;
    c.tx = 100;
    c.ty = 50;
    let moving = true;
    for (let i = 0; i < 200 && moving; i++) moving = c.update(1 / 60);
    expect(moving).toBe(false);
    expect(c.cx).toBe(100);
  });

  it('pans by screen delta and respects limits', () => {
    const c = cam();
    c.limits = { x: 0, y: 0, w: 100, h: 100 };
    c.cx = 50;
    c.cy = 50;
    c.zoom = 2;
    c.pan(-40, 0);
    expect(c.cx).toBe(70);
    c.pan(-4000, 0);
    expect(c.cx).toBe(100);
  });
});
