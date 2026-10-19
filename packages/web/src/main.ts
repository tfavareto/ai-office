// Entry point: picks the data source (server or ?mock=1), builds the app shell and loads the world renderer.
import './styles/index.css';
import { HttpBackend } from './net/http';
import { createMockEnvironment } from './net/mock';
import { Store } from './net/store';
import { SseTransport } from './net/transport';
import { PrefsStore } from './prefs/prefs';
import { App } from './ui/app';
import { h } from './ui/dom';
import { WorldHost } from './ui/world-host';

interface AiOfficeDebug {
  store: Store;
  app: App;
  world: WorldHost;
  debug(): Record<string, unknown>;
}

declare global {
  interface Window {
    aiOffice?: AiOfficeDebug;
  }
}

function isMockMode(): boolean {
  return new URLSearchParams(window.location.search).get('mock') === '1';
}

function showFatal(root: HTMLElement, message: string): void {
  root.replaceChildren(h('div', { class: 'ao-fatal', role: 'alert' }, h('h1', null, 'AI Office'), h('p', null, message)));
}

function createStore(): Store {
  if (isMockMode()) {
    const { transport, backend } = createMockEnvironment();
    return new Store({ transport, backend, mode: 'mock' });
  }
  return new Store({ transport: new SseTransport(), backend: new HttpBackend(), mode: 'live' });
}

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  root.classList.add('ao-root');
  let store: Store;
  try {
    store = createStore();
  } catch (error) {
    showFatal(root, error instanceof Error ? error.message : 'Não foi possível iniciar o AI Office.');
    return;
  }

  const prefs = new PrefsStore();
  const worldContainer = h('div', { class: 'ao-world', 'aria-hidden': 'true' });
  const world = new WorldHost(worldContainer);
  const app = new App(root, store, prefs, world, worldContainer);

  new ResizeObserver(() => world.resize()).observe(worldContainer);
  store.start();
  app.refresh();
  await app.switchVisual(prefs.get().visual);

  window.aiOffice = {
    store,
    app,
    world,
    debug: () => ({ mode: store.mode, connection: store.data.connection, rev: store.snapshot?.rev ?? null, kind: world.kind, world: world.stats() }),
  };
}

void main();
