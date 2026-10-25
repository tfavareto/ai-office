import { describe, expect, it } from 'vitest';
import { applyCustomizationPatch, emptyCustomization, type Customization } from '@ai-office/shared';
import { BackendError, type Backend } from '../net/backend';
import { CustomizationController } from './customization-controller';

function fakeBackend(options: { failing?: boolean } = {}) {
  let value: Customization = emptyCustomization();
  const calls: string[] = [];
  const backend = {
    customization: async () => {
      calls.push('get');
      if (options.failing) throw new BackendError('x', 500);
      return value;
    },
    patchCustomization: async (patch: object) => {
      calls.push('patch');
      const result = applyCustomizationPatch(value, patch);
      if (!result.ok) throw new BackendError(result.error.error, 400);
      value = result.value;
      return value;
    },
    resetCustomization: async () => {
      calls.push('reset');
      value = emptyCustomization();
      return value;
    },
  } as unknown as Backend;
  return { backend, calls };
}

describe('CustomizationController', () => {
  it('loads the document', async () => {
    const { backend } = fakeBackend();
    const controller = new CustomizationController(() => backend);
    expect(controller.get().status).toBe('idle');
    await controller.change({ agents: { a: { name: 'Ana' } } });
    await controller.load();
    expect(controller.get()).toMatchObject({
      status: 'ready',
      error: '',
      document: { agents: { a: { name: 'Ana' } } },
    });
  });

  it('says why a load failed and keeps what it showed on a quiet reload', async () => {
    const { backend } = fakeBackend({ failing: true });
    const controller = new CustomizationController(() => backend);
    await controller.load();
    expect(controller.get().status).toBe('error');
    expect(controller.get().error.length).toBeGreaterThan(0);
    let current = fakeBackend().backend;
    const second = new CustomizationController(() => current);
    await second.load();
    current = backend;
    await second.load(true);
    expect(second.get().status).toBe('ready');
  });

  it('replaces the document with the server answer after a change and tells when it is refused', async () => {
    const { backend } = fakeBackend();
    const controller = new CustomizationController(() => backend);
    const seen: boolean[] = [];
    controller.subscribe((data) => seen.push(data.busy));
    expect(await controller.change({ rooms: { '/p': { pinned: true } } })).toEqual({ ok: true });
    expect(controller.get().document.rooms['/p']).toEqual({ pinned: true });
    expect(seen).toEqual([true, false]);
    const refused = await controller.change({ agents: { a: { name: '' } } });
    expect(refused.ok).toBe(false);
    expect(controller.get().busy).toBe(false);
    expect(controller.get().document.rooms['/p']).toEqual({ pinned: true });
  });

  it('resets everything', async () => {
    const { backend, calls } = fakeBackend();
    const controller = new CustomizationController(() => backend);
    await controller.change({ order: ['/p'] });
    expect(await controller.resetAll()).toEqual({ ok: true });
    expect(controller.get().document).toEqual(emptyCustomization());
    expect(calls).toEqual(['patch', 'reset']);
  });
});
