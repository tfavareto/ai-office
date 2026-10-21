import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuleBook, type RuleDraft, type RuleResult } from '@ai-office/shared';
import { RuleRejectedError, type Backend } from '../net/backend';
import { PREVIEW_DELAY_MS, REFRESH_MS, RulesController } from './rules-controller';

const draft: RuleDraft = { effect: 'allow', tool: 'Bash', matcher: { kind: 'command-prefix', value: 'npm test' }, scope: { projectPath: '/demo/loja' }, enabled: true };

function unwrap<T>(result: RuleResult<T>): T {
  if (result.ok) return result.value;
  throw new RuleRejectedError({ error: result.error.code, ...(result.error.detail !== undefined ? { detail: result.error.detail } : {}) }, 400);
}

/** A backend whose rules live in a shared RuleBook, like the server's. */
function fakeBackend() {
  let ids = 0;
  const book = new RuleBook({ now: () => 1_000, newId: () => `r${++ids}` });
  const calls = { previews: 0, rules: 0 };
  const backend = {
    rules: async () => {
      calls.rules++;
      return [...book.rules()];
    },
    ruleLog: async () => book.log(),
    createRule: async (value: RuleDraft) => unwrap(book.create(value)),
    updateRule: async (id: string, patch: object) => unwrap(book.update(id, patch)),
    deleteRule: async (id: string) => void book.remove(id),
    clearRuleLog: async () => book.clearLog(),
    previewRule: async (value: RuleDraft) => {
      calls.previews++;
      return unwrap(book.preview(value));
    },
  } as unknown as Backend;
  return { backend, book, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('RulesController: loading', () => {
  it('loads rules and log when the dialog starts', async () => {
    const { backend, book } = fakeBackend();
    book.create(draft);
    const controller = new RulesController(() => backend);
    controller.start();
    expect(controller.get().status).toBe('loading');
    await settle();
    expect(controller.get()).toMatchObject({ status: 'ready', rules: [{ id: 'r1' }], log: [] });
    controller.stop();
  });

  it('reports a failure to load', async () => {
    const backend = { rules: async () => Promise.reject(new Error('boom')), ruleLog: async () => [] } as unknown as Backend;
    const controller = new RulesController(() => backend);
    controller.start();
    await settle();
    expect(controller.get().status).toBe('error');
    controller.stop();
  });

  it('keeps the counters fresh while open, and stops when closed', async () => {
    const { backend, calls } = fakeBackend();
    const controller = new RulesController(() => backend);
    controller.start();
    await settle();
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(calls.rules).toBe(2);
    controller.stop();
    await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
    expect(calls.rules).toBe(2);
  });

  it('does not refresh underneath an open editor', async () => {
    const { backend, calls } = fakeBackend();
    const controller = new RulesController(() => backend);
    controller.start();
    await settle();
    controller.startNew(draft);
    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    expect(calls.rules).toBe(1);
    controller.stop();
  });
});

describe('RulesController: editor and preview', () => {
  it('previews the pre-filled rule right away and again after edits, once per pause', async () => {
    const { backend, calls } = fakeBackend();
    const controller = new RulesController(() => backend);
    controller.startNew(draft, { agentName: 'Ana', summary: 'npm test' });
    await settle();
    expect(controller.get().editor).toMatchObject({ ruleId: null, source: { agentName: 'Ana' }, preview: { status: 'ready', preview: { matches: 0, total: 0 } } });
    controller.setForm({ value: 'npm' });
    controller.setForm({ value: 'npm t' });
    controller.setForm({ value: 'npm te' });
    await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    expect(calls.previews).toBe(2);
  });

  it('shows why a draft is refused in the preview, without blocking edits', async () => {
    const { backend } = fakeBackend();
    const controller = new RulesController(() => backend);
    controller.startNew({ ...draft, matcher: { kind: 'command-prefix', value: 'git push' } });
    await settle();
    expect(controller.get().editor?.preview).toMatchObject({ status: 'refused', rejection: { error: 'matcher-dangerous' } });
  });

  it('does not preview an incomplete form', async () => {
    const { backend, calls } = fakeBackend();
    const controller = new RulesController(() => backend);
    controller.startNew({ ...draft, matcher: { kind: 'command-prefix', value: '' } });
    await settle();
    expect(calls.previews).toBe(0);
    expect(controller.get().editor?.preview).toEqual({ status: 'idle' });
  });

  it('resets the matcher when the tool changes to one that does not understand it', async () => {
    const { backend } = fakeBackend();
    const controller = new RulesController(() => backend);
    controller.startNew(draft);
    controller.setTool('Edit');
    expect(controller.get().editor?.form).toMatchObject({ tool: 'Edit', kind: 'path-glob', value: '' });
  });

  it('saves a new rule, closes the editor and lists it', async () => {
    const { backend } = fakeBackend();
    const controller = new RulesController(() => backend);
    controller.startNew(draft);
    const saved = await controller.save();
    expect(saved).toMatchObject({ id: 'r1' });
    expect(controller.get()).toMatchObject({ editor: null, tab: 'rules', rules: [{ id: 'r1' }] });
  });

  it('keeps the editor open and explains a refused rule', async () => {
    const { backend } = fakeBackend();
    const controller = new RulesController(() => backend);
    controller.startNew({ ...draft, matcher: { kind: 'command-prefix', value: 'sudo' } });
    expect(await controller.save()).toBeNull();
    expect(controller.get().editor).toMatchObject({ saving: false, refusal: { error: 'matcher-dangerous' } });
    controller.setForm({ value: 'npm test' });
    expect(controller.get().editor?.refusal).toBeNull();
  });

  it('edits an existing rule, including removing its note', async () => {
    const { backend, book } = fakeBackend();
    book.create({ ...draft, note: 'antiga' });
    const controller = new RulesController(() => backend);
    controller.start();
    await settle();
    controller.startEdit(controller.get().rules[0]!);
    controller.setForm({ note: '', onlyProject: false });
    await controller.save();
    expect(book.rules()[0]).toMatchObject({ id: 'r1', scope: {} });
    expect(book.rules()[0]?.note).toBeUndefined();
    controller.stop();
  });
});

describe('RulesController: list actions', () => {
  it('toggles and deletes rules', async () => {
    const { backend, book } = fakeBackend();
    book.create(draft);
    const controller = new RulesController(() => backend);
    controller.start();
    await settle();
    expect(await controller.toggle(controller.get().rules[0]!)).toEqual({ ok: true });
    expect(controller.get().rules[0]?.enabled).toBe(false);
    controller.askDelete('r1');
    expect(controller.get().confirmDelete).toBe('r1');
    await controller.remove('r1');
    expect(controller.get()).toMatchObject({ rules: [], confirmDelete: null });
    controller.stop();
  });

  it('clears the log and filters it by rule', async () => {
    const { backend, book } = fakeBackend();
    book.create(draft);
    book.decide({ toolName: 'Bash', input: { command: 'npm test' }, summary: 'npm test', agentId: 'a', agentName: 'Ana', projectPath: '/demo/loja' });
    const controller = new RulesController(() => backend);
    controller.start();
    await settle();
    expect(controller.get().log).toHaveLength(1);
    controller.showLogOf('r1');
    expect(controller.get()).toMatchObject({ tab: 'log', filter: { ruleId: 'r1' } });
    expect(await controller.clearLog()).toEqual({ ok: true });
    expect(controller.get().log).toEqual([]);
    controller.stop();
  });

  it('reports a failure instead of throwing', async () => {
    const { backend } = fakeBackend();
    (backend as unknown as { deleteRule: () => Promise<void> }).deleteRule = async () => Promise.reject(new Error('boom'));
    const controller = new RulesController(() => backend);
    const result = await controller.remove('r1');
    expect(result.ok).toBe(false);
    expect(controller.get().busy).toBe(false);
  });
});
