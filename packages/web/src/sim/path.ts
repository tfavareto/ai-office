import { isWalkable } from '../layout/grid';
import type { Grid, TilePos } from '../layout/types';

export interface Vec {
  x: number;
  y: number;
}

const SQRT2 = Math.SQRT2;
const NEIGHBORS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [-1, 1, SQRT2], [1, -1, SQRT2], [-1, -1, SQRT2],
];

/** Binary min-heap of node indices keyed by f-score. */
class MinHeap {
  private nodes: number[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, key: number): void {
    let i = this.nodes.length;
    this.nodes.push(node);
    this.keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.nodes[0];
    const lastNode = this.nodes.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.nodes.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.nodes.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b], this.nodes[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

/**
 * A* over walkable tiles, 8 directions with corner rules (a diagonal step needs both orthogonal neighbours free).
 * The start and goal tiles are always allowed even when blocked (characters leave seats and reach stools).
 * Returns tiles from start to goal inclusive, or null when unreachable.
 */
export function findPath(grid: Grid, start: TilePos, goal: TilePos): TilePos[] | null {
  const { width, height } = grid;
  if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) return null;
  if (goal.x < 0 || goal.y < 0 || goal.x >= width || goal.y >= height) return null;
  const startIdx = start.y * width + start.x;
  const goalIdx = goal.y * width + goal.x;
  if (startIdx === goalIdx) return [{ x: start.x, y: start.y }];

  const total = width * height;
  const g = new Float32Array(total).fill(Infinity);
  const from = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const open = new MinHeap();
  const heuristic = (x: number, y: number): number => {
    const dx = Math.abs(x - goal.x);
    const dy = Math.abs(y - goal.y);
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  };

  g[startIdx] = 0;
  open.push(startIdx, heuristic(start.x, start.y));
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalIdx) break;
    const cx = cur % width;
    const cy = (cur / width) | 0;
    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (closed[ni]) continue;
      const isGoal = ni === goalIdx;
      if (!isGoal && grid.walkable[ni] !== 1) continue;
      if (dx !== 0 && dy !== 0) {
        if (grid.walkable[cy * width + nx] !== 1 || grid.walkable[ny * width + cx] !== 1) continue;
      }
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        from[ni] = cur;
        open.push(ni, ng + heuristic(nx, ny));
      }
    }
  }
  if (from[goalIdx] === -1) return null;
  const tiles: TilePos[] = [];
  for (let n = goalIdx; n !== -1; n = from[n]) tiles.push({ x: n % width, y: (n / width) | 0 });
  return tiles.reverse();
}

const CLEARANCE = 0.28;
const SAMPLE_STEP = 0.2;

/** True when a character of radius CLEARANCE can walk the straight segment without touching a blocked tile. */
export function segmentClear(grid: Grid, a: Vec, b: Vec): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    for (const ox of [-CLEARANCE, CLEARANCE]) {
      for (const oy of [-CLEARANCE, CLEARANCE]) {
        if (!isWalkable(grid, Math.floor(x + ox), Math.floor(y + oy))) return false;
      }
    }
  }
  return true;
}

/** String-pulls a tile path into the fewest straight, collision-free waypoints (tile centres). */
export function smoothPath(grid: Grid, tiles: readonly TilePos[], from?: Vec): Vec[] {
  const points: Vec[] = tiles.map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 }));
  if (points.length === 0) return [];
  const start = from ?? points[0];
  const result: Vec[] = [];
  let anchor = start;
  let i = 0;
  while (i < points.length) {
    let far = i;
    for (let j = points.length - 1; j > i; j--) {
      if (segmentClear(grid, anchor, points[j])) {
        far = j;
        break;
      }
    }
    result.push(points[far]);
    anchor = points[far];
    i = far + 1;
  }
  return result;
}

export function pathLength(points: readonly Vec[], from: Vec): number {
  let total = 0;
  let prev = from;
  for (const p of points) {
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return total;
}
