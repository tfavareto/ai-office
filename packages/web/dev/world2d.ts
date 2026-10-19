// Dev harness: mounts the 2D world full-screen with a synthetic office. Query: ?daylight=day|night|auto
// &projects=4&agents=10&step=4&zoom=2&hud=1&insets=top,right,bottom,left (CSS px, like the app shell)
import { createWorld2D } from '../src/world2d';
import type { DaylightMode, WorldApi } from '../src/world/api';
import { DEFAULT_WORLD_OPTIONS } from '../src/world/api';
import { type FixtureOptions, makeFixture } from './fixture';

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number => Number(params.get(key) ?? fallback);
const daylight = (params.get('daylight') ?? 'day') as DaylightMode;
const fixture: FixtureOptions = { projects: num('projects', 4), agents: num('agents', 10), step: num('step', 4) };
const [top = 0, right = 0, bottom = 0, left = 0] = (params.get('insets') ?? '').split(',').map(Number);
const force = params.get('force');
if (force) fixture.force = force as FixtureOptions['force'];

declare global {
  interface Window {
    __world?: WorldApi;
    __stats?: () => unknown;
    __fixture?: typeof fixture;
  }
}

async function main(): Promise<void> {
  const container = document.getElementById('world')!;
  const world = await createWorld2D(container, {
    options: { ...DEFAULT_WORLD_OPTIONS, daylight, bubbles: 'all' },
    insets: { top, right, bottom, left },
  });
  window.__world = world;
  window.__stats = () => world.stats();
  window.__fixture = fixture;
  const push = (): void => world.setSnapshot(makeFixture(fixture, Date.now()), Date.now());
  push();
  setInterval(push, 1000);
  const hud = document.getElementById('hud')!;
  if (params.get('hud') !== '1') hud.style.display = 'none';
  setInterval(() => {
    const s = world.stats();
    hud.textContent = `fps ${s.fps} · draw ${s.drawMs} ms · agentes ${s.agents}`;
  }, 500);
  const zoom = params.get('zoom');
  if (zoom) {
    setTimeout(() => {
      const target = Number(zoom);
      for (let i = 0; i < 8; i++) world.zoomBy(1 / 1.25);
      let level = 0.5;
      while (level < target && level < 6) {
        world.zoomBy(1.25);
        level = (world.stats().extra?.zoom as number) ?? target;
        if (level >= target) break;
      }
    }, 300);
  }
}

void main();
