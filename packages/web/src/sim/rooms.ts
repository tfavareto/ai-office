import type { Project } from '@ai-office/shared';
import type { RoomSpec } from '../layout/types';

export type RoomPhase = 'building' | 'open' | 'dismantling';

export const BUILD_SECONDS = 2.8;
export const DISMANTLE_SECONDS = 2.2;

export interface RoomState {
  /** Layout area id: `room:<projectId>` for live rooms, `ghost:<projectId>:<slot>` for rooms being dismantled. */
  areaId: string;
  projectId: string;
  name: string;
  seed: number;
  slot: number;
  phase: RoomPhase;
  /** Seconds spent in the current phase. */
  t: number;
  ghost: boolean;
  /** 0 = nothing built, 1 = complete; drives the build-in / dismantle animation. */
  progress: number;
}

export interface RoomMove {
  projectId: string;
  fromAreaId: string;
  toAreaId: string;
  fromSlot: number;
  toSlot: number;
}

export interface RoomUpdate {
  /** The set of areas or their positions changed: recompute the layout. */
  layoutChanged: boolean;
  moves: RoomMove[];
  removed: string[];
}

const liveId = (projectId: string): string => `room:${projectId}`;

/** Owns the project rooms: slot assignment, build/dismantle lifecycle and compaction into freed slots. */
export class RoomManager {
  private rooms: RoomState[] = [];
  private seenFirst = false;
  private ghostCounter = 0;

  get all(): readonly RoomState[] {
    return this.rooms;
  }

  live(projectId: string): RoomState | undefined {
    return this.rooms.find((r) => !r.ghost && r.projectId === projectId);
  }

  byArea(areaId: string): RoomState | undefined {
    return this.rooms.find((r) => r.areaId === areaId);
  }

  specs(): RoomSpec[] {
    return this.rooms.map((r) => ({ id: r.projectId, seed: r.seed, name: r.name, slot: r.slot, areaId: r.areaId }));
  }

  /** Sync with the snapshot's projects. Returns true when anything changed. */
  sync(projects: readonly Project[]): boolean {
    let changed = false;
    const ids = new Set(projects.map((p) => p.id));
    const instant = !this.seenFirst;
    this.seenFirst = true;

    for (const room of this.rooms) {
      if (room.ghost || room.phase === 'dismantling' || ids.has(room.projectId)) continue;
      this.close(room);
      changed = true;
    }
    const sorted = [...projects].sort((a, b) => a.order - b.order);
    for (const project of sorted) {
      const existing = this.live(project.id);
      if (existing) {
        if (existing.name !== project.name || existing.seed !== project.seed) {
          existing.name = project.name;
          existing.seed = project.seed;
          changed = true;
        }
        continue;
      }
      const slot = this.lowestFreeSlot();
      this.rooms.push({
        areaId: liveId(project.id),
        projectId: project.id,
        name: project.name,
        seed: project.seed,
        slot,
        phase: instant ? 'open' : 'building',
        t: 0,
        ghost: false,
        progress: instant ? 1 : 0,
      });
      changed = true;
    }
    return changed;
  }

  /** Advance animations; `occupied(areaId)` tells whether people are still inside a room being dismantled. */
  advance(dt: number, occupied: (areaId: string) => boolean): RoomUpdate {
    const update: RoomUpdate = { layoutChanged: false, moves: [], removed: [] };
    for (const room of this.rooms) {
      room.t += dt;
      if (room.phase === 'building') {
        room.progress = Math.min(1, room.t / BUILD_SECONDS);
        if (room.progress >= 1) {
          room.phase = 'open';
          room.t = 0;
        }
      } else if (room.phase === 'dismantling') {
        room.progress = Math.max(0, 1 - room.t / DISMANTLE_SECONDS);
      }
    }
    const before = this.rooms.length;
    this.rooms = this.rooms.filter((r) => {
      const finished = r.phase === 'dismantling' && r.progress <= 0 && !occupied(r.areaId);
      if (finished) update.removed.push(r.areaId);
      return !finished;
    });
    if (this.rooms.length !== before) update.layoutChanged = true;

    const move = this.compact();
    if (move) {
      update.moves.push(move);
      update.layoutChanged = true;
    }
    return update;
  }

  private close(room: RoomState): void {
    room.ghost = true;
    room.phase = 'dismantling';
    room.t = (1 - room.progress) * DISMANTLE_SECONDS;
    room.areaId = `ghost:${room.projectId}:${this.ghostCounter++}`;
  }

  private lowestFreeSlot(): number {
    const used = new Set(this.rooms.map((r) => r.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    return slot;
  }

  /** The farthest open room moves into the lowest freed slot (one move at a time). */
  private compact(): RoomMove | null {
    if (this.rooms.some((r) => r.phase === 'building')) return null;
    const free = this.lowestFreeSlot();
    let farthest: RoomState | undefined;
    for (const r of this.rooms) {
      if (!r.ghost && r.phase === 'open' && r.slot > free && (!farthest || r.slot > farthest.slot)) farthest = r;
    }
    if (!farthest) return null;
    const fromAreaId = farthest.areaId;
    const fromSlot = farthest.slot;
    this.rooms.push({
      areaId: `ghost:${farthest.projectId}:${this.ghostCounter++}`,
      projectId: farthest.projectId,
      name: farthest.name,
      seed: farthest.seed,
      slot: fromSlot,
      phase: 'dismantling',
      t: 0,
      ghost: true,
      progress: 1,
    });
    farthest.slot = free;
    farthest.phase = 'building';
    farthest.t = 0;
    farthest.progress = 0;
    return { projectId: farthest.projectId, fromAreaId, toAreaId: farthest.areaId, fromSlot, toSlot: free };
  }
}
