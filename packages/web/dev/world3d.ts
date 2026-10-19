// Dev harness: mounts the 3D world full-screen with a synthetic office. Query: ?daylight=day|night|auto&projects=4
// &agents=10&step=4&hud=1&mode=overview|first-person|shoulder&zoom=1.2&select=agent-0&force=working
import { createWorld3D } from '../src/world3d';
import { DEFAULT_WORLD_OPTIONS, type CameraMode, type DaylightMode, type WorldApi } from '../src/world/api';
import { type FixtureOptions, makeFixture } from './fixture';

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number => Number(params.get(key) ?? fallback);
const daylight = (params.get('daylight') ?? 'day') as DaylightMode;
const fixture: FixtureOptions = { projects: num('projects', 4), agents: num('agents', 10), step: num('step', 4) };
const force = params.get('force');
if (force) fixture.force = force as FixtureOptions['force'];

declare global {
  interface Window {
    __world?: WorldApi;
    __stats?: () => unknown;
    __fixture?: FixtureOptions;
    __ready?: boolean;
  }
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const container = document.getElementById('world')!;
  const world = await createWorld3D(container, {
    options: { ...DEFAULT_WORLD_OPTIONS, daylight, bubbles: 'all' },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
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
    hud.textContent = `fps ${s.fps} · cpu ${s.drawMs} ms · agentes ${s.agents} · calls ${String(s.extra?.drawCalls)} · dpr ${String(s.extra?.pixelRatio)}`;
  }, 500);
  const select = params.get('select');
  if (select) world.select({ type: 'agent', id: select }, { focus: params.get('focus') !== '0' });
  const mode = params.get('mode') as CameraMode | null;
  if (mode) setTimeout(() => world.setCameraMode(mode), 800);
  const zoom = params.get('zoom');
  if (zoom) setTimeout(() => world.zoomBy(Number(zoom)), 500);
  console.warn(`world3d ready in ${Math.round(performance.now() - t0)} ms`);
  window.__ready = true;
}

main().catch((e) => {
  console.error(e);
  document.title = 'error';
});
