// Picks and loads the world renderer. Renderers are separate lazy chunks; a missing or failing one never breaks the UI.
import type { WorldApi, WorldFactory, WorldFactoryOptions } from './api';

export type WorldKind = '2d' | '3d';

interface World2DModule {
  createWorld2D: WorldFactory;
}
interface World3DModule {
  createWorld3D: WorldFactory;
}

// import.meta.glob keeps the build working when a renderer folder is absent (the map is simply empty).
const loaders2d = import.meta.glob<World2DModule>('../world2d/index.ts');
const loaders3d = import.meta.glob<World3DModule>('../world3d/index.ts');

export interface WorldLoadResult {
  world: WorldApi | null;
  kind: WorldKind;
  /** Friendly pt-BR explanation when the requested visual could not be used. */
  notice?: string;
}

async function factoryFor(kind: WorldKind): Promise<WorldFactory> {
  if (kind === '2d') {
    const load = Object.values(loaders2d)[0];
    if (!load) throw new Error('missing');
    return (await load()).createWorld2D;
  }
  const load = Object.values(loaders3d)[0];
  if (!load) throw new Error('missing');
  return (await load()).createWorld3D;
}

async function tryCreate(kind: WorldKind, container: HTMLElement, opts: WorldFactoryOptions): Promise<WorldApi> {
  const factory = await factoryFor(kind);
  return factory(container, opts);
}

const LABEL: Record<WorldKind, string> = { '2d': '2D', '3d': '3D' };

/** Creates the requested world; falls back to 2D when 3D is unavailable. */
export async function createWorld(
  kind: WorldKind,
  container: HTMLElement,
  opts: WorldFactoryOptions,
): Promise<WorldLoadResult> {
  try {
    return { world: await tryCreate(kind, container, opts), kind };
  } catch (error) {
    container.replaceChildren();
    if (kind === '3d') {
      const fallback = await createWorld('2d', container, opts);
      const reason =
        error instanceof Error && error.message === 'missing'
          ? 'não está disponível nesta compilação'
          : 'não pôde ser iniciado neste navegador';
      return { ...fallback, notice: `O visual ${LABEL[kind]} ${reason}. Usando o 2D.` };
    }
    return {
      world: null,
      kind,
      notice: 'O escritório 2D não está disponível nesta compilação. O painel segue funcionando.',
    };
  }
}
