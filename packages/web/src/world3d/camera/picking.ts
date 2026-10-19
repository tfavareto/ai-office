// Pure picking helpers: screen-space capsules for people, a view-cone search for first person.

export interface ScreenCapsule {
  id: string;
  /** Feet and head in CSS px. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radius: number;
  /** Distance from the camera: nearer wins when capsules overlap. */
  depth: number;
}

function distToSegment(px: number, py: number, c: ScreenCapsule): number {
  const dx = c.bx - c.ax;
  const dy = c.by - c.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - c.ax) * dx + (py - c.ay) * dy) / len2));
  return Math.hypot(px - (c.ax + dx * t), py - (c.ay + dy * t));
}

/** The nearest capsule under a screen point, or null. */
export function pickCapsule(capsules: readonly ScreenCapsule[], px: number, py: number): string | null {
  let best: ScreenCapsule | null = null;
  for (const c of capsules) {
    if (distToSegment(px, py, c) > c.radius) continue;
    if (!best || c.depth < best.depth) best = c;
  }
  return best ? best.id : null;
}

export interface SightTarget {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** The target closest to the view direction within a cone and a maximum distance (first-person "E to open"). */
export function targetInSight(
  eye: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  targets: readonly SightTarget[],
  maxDistance = 9,
  coneDegrees = 10,
): string | null {
  const cos = Math.cos((coneDegrees * Math.PI) / 180);
  let best: { id: string; score: number } | null = null;
  for (const t of targets) {
    const vx = t.x - eye.x;
    const vy = t.y - eye.y;
    const vz = t.z - eye.z;
    const dist = Math.hypot(vx, vy, vz);
    if (dist < 0.3 || dist > maxDistance) continue;
    const dot = (vx * dir.x + vy * dir.y + vz * dir.z) / dist;
    if (dot < cos) continue;
    const score = dot - dist * 0.004;
    if (!best || score > best.score) best = { id: t.id, score };
  }
  return best ? best.id : null;
}
