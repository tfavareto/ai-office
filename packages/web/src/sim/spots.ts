import type { BuildingLayout, Spot, SpotKind } from '../layout/types';
import { allSpots } from '../layout/building';

/** Index of every spot in the building plus who has claimed it. */
export class SpotBook {
  private byId = new Map<string, Spot>();
  private claims = new Map<string, string>();
  private list: Spot[] = [];

  rebuild(building: BuildingLayout): void {
    this.list = allSpots(building);
    this.byId = new Map(this.list.map((s) => [s.id, s]));
    for (const [spotId] of this.claims) {
      if (!this.byId.has(spotId)) this.claims.delete(spotId);
    }
  }

  get(id: string): Spot | undefined {
    return this.byId.get(id);
  }

  claimant(spotId: string): string | undefined {
    return this.claims.get(spotId);
  }

  isFree(spotId: string, by?: string): boolean {
    const owner = this.claims.get(spotId);
    return owner === undefined || owner === by;
  }

  claim(spotId: string, charId: string): boolean {
    if (!this.byId.has(spotId) || !this.isFree(spotId, charId)) return false;
    this.claims.set(spotId, charId);
    return true;
  }

  release(spotId: string, charId: string): void {
    if (this.claims.get(spotId) === charId) this.claims.delete(spotId);
  }

  releaseAll(charId: string): void {
    for (const [spotId, owner] of this.claims) if (owner === charId) this.claims.delete(spotId);
  }

  /** Free spots of a kind (optionally restricted to an area), in layout order. */
  free(kind: SpotKind, areaId?: string, by?: string): Spot[] {
    return this.list.filter((s) => s.kind === kind && (!areaId || s.areaId === areaId) && this.isFree(s.id, by));
  }

  inGroup(group: string): Spot[] {
    return this.list.filter((s) => s.group === group);
  }

  inArea(areaId: string): Spot[] {
    return this.list.filter((s) => s.areaId === areaId);
  }

  all(): readonly Spot[] {
    return this.list;
  }
}
