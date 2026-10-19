import { BoxGeometry, MeshBasicMaterial, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { boxGeometry, groundQuad, PartCollector, transform } from './parts';

describe('boxGeometry', () => {
  it('is cached by dimensions and texture scale', () => {
    expect(boxGeometry(1, 2, 3, 1)).toBe(boxGeometry(1, 2, 3, 1));
    expect(boxGeometry(1, 2, 3, 1)).not.toBe(boxGeometry(1, 2, 3, 2));
  });

  it('keeps texture coordinates in real-world units', () => {
    const geo = boxGeometry(2, 1, 4, 2);
    const uv = geo.getAttribute('uv');
    // +y face (top): width 2 m, depth 4 m, one repeat = 2 m
    const top = [8, 9, 10, 11].map((i) => [uv.getX(i), uv.getY(i)]);
    const us = top.map((p) => p[0]);
    const vs = top.map((p) => p[1]);
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(1);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(2);
    expect(geo).toBeInstanceOf(BoxGeometry);
  });
});

describe('PartCollector', () => {
  const shadow = () => ({ cast: true, receive: true });

  it('merges parts that share a material into one mesh', () => {
    const wood = new MeshBasicMaterial();
    const metal = new MeshBasicMaterial();
    const c = new PartCollector();
    c.box(wood, 0, 0, 0, 1, 1, 1).box(wood, 3, 0, 0, 1, 1, 1).box(metal, 6, 0, 0, 1, 1, 1);
    const group = c.build(shadow);
    expect(group.children).toHaveLength(2);
  });

  it('bakes transforms into the merged geometry', () => {
    const m = new MeshBasicMaterial();
    const c = new PartCollector();
    c.box(m, 10, 0, 0, 1, 1, 1).box(m, 20, 0, 0, 1, 1, 1);
    const mesh = c.build(shadow).children[0] as import('three').Mesh;
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.min.x).toBeCloseTo(9.5);
    expect(mesh.geometry.boundingBox!.max.x).toBeCloseTo(20.5);
  });

  it('merges indexed and non-indexed geometry of one material', () => {
    const m = new MeshBasicMaterial();
    const c = new PartCollector();
    c.add(groundQuad(0, 0, 1, 1, 0, 1), m).box(m, 5, 0, 0, 1, 1, 1);
    c.add(boxGeometry(1, 1, 1).toNonIndexed(), m, new Matrix4());
    expect(c.build(shadow).children).toHaveLength(1);
  });

  it('applies a group transform to another collector', () => {
    const m = new MeshBasicMaterial();
    const inner = new PartCollector().box(m, 0, 0, 0, 1, 1, 1);
    const outer = new PartCollector().addAll(inner, transform(7, 0, 0));
    expect(outer.parts[0].matrix.elements[12]).toBeCloseTo(7);
  });
});
