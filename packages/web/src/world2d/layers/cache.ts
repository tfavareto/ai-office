import type { Locale } from '@ai-office/shared';
import { worldText } from '../../i18n/world/translate';
import { TILE } from '../../layout/constants';
import { layoutExterior, type ExteriorLayout } from '../../layout/exterior';
import type { BuildingLayout } from '../../layout/types';
import { BASE_EVOLUTION, type Evolution } from '../../world/evolution';
import { context2d, makeCanvas } from '../paint/ctx';
import { paintExterior } from '../paint/exterior';
import { type CityWindow, REFERENCE_WINDOW, cityMargins, growWindow } from '../cityMargins';
import { type AreaCanvas, areaKey, buildAreaCanvas, buildCorridorCanvas, buildEndCap } from './areaLayer';

export interface ExteriorCanvas {
  canvas: HTMLCanvasElement;
  layout: ExteriorLayout;
  /** World px of the canvas top-left. */
  x: number;
  y: number;
  key: string;
}

/** Pre-rendered static layers; rebuilt only for the pieces whose layout actually changed. */
export class LayerCache {
  readonly areas = new Map<string, AreaCanvas>();
  corridor: AreaCanvas | null = null;
  endCap: HTMLCanvasElement | null = null;
  exterior: ExteriorCanvas | null = null;
  /** The window the city around the building is sized for (it only grows); stills use a large reference one. */
  private window: CityWindow | null = null;
  /** Bumped whenever any layer was (re)built, so renderers can refresh dependent data. */
  version = 0;

  /** Tells the cache how big the canvas is, so the city is only as large as that window can show. */
  setWindow(win: CityWindow): void {
    this.window = growWindow(this.window, win);
  }

  /** Returns the built areas in drawing order (north row, corridor, south row) after syncing. */
  sync(building: BuildingLayout, locale: Locale = 'pt-BR', evolution: Evolution = BASE_EVOLUTION): void {
    const text = worldText(locale);
    const present = new Set<string>();
    const theme = building.corridor.theme;
    for (const area of [...building.areas, ...building.terraces]) {
      present.add(area.id);
      const key = areaKey(area, '', locale, evolution);
      const hit = this.areas.get(area.id);
      if (hit?.key === key) continue;
      this.areas.set(area.id, buildAreaCanvas(area, key, theme, 0, text, evolution));
      this.version++;
    }
    for (const id of [...this.areas.keys()]) if (!present.has(id)) this.areas.delete(id);

    const ckey = `${building.width}|${areaKey(building.corridor, '', 'pt-BR', evolution)}|${building.areas.map((a) => a.doors.map((d) => d.rect.x).join()).join(';')}`;
    if (this.corridor?.key !== ckey) {
      this.corridor = buildCorridorCanvas(building.corridor, building.width, ckey, evolution);
      this.version++;
    }
    if (!this.endCap) this.endCap = buildEndCap(building.height);

    const margins = cityMargins(building.width, this.window ?? REFERENCE_WINDOW);
    const ekey = `${building.width}|${margins.left},${margins.right},${margins.top},${margins.bottom}`;
    if (this.exterior?.key !== ekey) {
      const layout = layoutExterior(building.width, margins);
      const canvas = makeCanvas(layout.bounds.w * TILE, layout.bounds.h * TILE);
      const ctx = context2d(canvas);
      ctx.translate(-layout.bounds.x * TILE, -layout.bounds.y * TILE);
      paintExterior(ctx, layout);
      this.exterior = { canvas, layout, x: layout.bounds.x * TILE, y: layout.bounds.y * TILE, key: ekey };
      this.version++;
    }
  }

  /** Area canvases sorted for drawing: by row then x. */
  ordered(): AreaCanvas[] {
    const list = [...this.areas.values()];
    if (this.corridor) list.push(this.corridor);
    return list.sort((a, b) => a.y - b.y || a.x - b.x);
  }
}
