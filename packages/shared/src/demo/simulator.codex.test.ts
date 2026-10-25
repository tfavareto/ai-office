import { describe, expect, test } from 'vitest';
import type { Agent } from '../model';
import { DEMO_ALL_ACCOUNTS, DEMO_CODEX_ACCOUNT } from './content';
import { createDemoSimulator } from './simulator';

const T0 = 1_800_000_000_000;

function runFor(seconds: number, seed = 1) {
  let clock = T0;
  const sim = createDemoSimulator({ seed, now: () => clock });
  const agents: Agent[][] = [];
  for (let t = 0; t <= seconds * 1000; t += 500) {
    clock = T0 + t;
    sim.tick(clock);
    agents.push(sim.agents());
  }
  return { sim, history: agents, clock };
}

describe('Codex sessions in the demo office', () => {
  test('the opening scene has Codex agents, one sharing a room with a Claude Code agent', () => {
    const sim = createDemoSimulator({ seed: 1, now: () => T0 });
    const mains = sim.agents().filter((agent) => agent.kind === 'main');
    const codex = mains.filter((agent) => agent.source === 'codex');
    expect(codex.length).toBeGreaterThanOrEqual(2);
    expect(codex.every((agent) => agent.accountId === DEMO_CODEX_ACCOUNT.id)).toBe(true);
    expect(codex.every((agent) => (agent.model ?? '').startsWith('gpt-'))).toBe(true);
    const mixed = codex.some((agent) =>
      mains.some((other) => other.projectId === agent.projectId && other.source !== 'codex'),
    );
    expect(mixed).toBe(true);
    const alone = codex.some((agent) => mains.every((other) => other === agent || other.projectId !== agent.projectId));
    expect(alone).toBe(true);
  });

  test('the snapshot carries the Codex account and its usage card', () => {
    const snapshot = createDemoSimulator({ seed: 1, now: () => T0 }).snapshot(T0);
    expect(snapshot.accounts.map((account) => account.id)).toEqual(DEMO_ALL_ACCOUNTS.map((account) => account.id));
    expect(snapshot.accounts.find((account) => account.id === 'demo-codex')).toMatchObject({
      label: 'Codex',
      source: 'codex',
    });
    expect(snapshot.usage.map((usage) => usage.accountId)).toContain('demo-codex');
  });

  test('Codex agents never get a permission request, only an approval they wait for', () => {
    const { history } = runFor(900, 3);
    const codex = history.flat().filter((agent) => agent.source === 'codex');
    expect(codex.some((agent) => agent.permission !== undefined)).toBe(false);
    const waiting = codex.filter((agent) => agent.status === 'waiting');
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((agent) => agent.waitingForMsg !== undefined)).toBe(true);
    expect(waiting.some((agent) => agent.waitingForMsg?.key === 'waiting.approve')).toBe(true);
  });

  test('messages are not delivered to Codex agents', () => {
    const sim = createDemoSimulator({ seed: 1, now: () => T0 });
    const codex = sim.agents().find((agent) => agent.source === 'codex') as Agent;
    const claude = sim.agents().find((agent) => agent.kind === 'main' && agent.source !== 'codex') as Agent;
    const messages = sim.sendMessage([codex.id, claude.id], 'oi', T0);
    expect(messages.map((message) => message.agentId)).toEqual([claude.id]);
  });

  test('subagents of a Codex agent are Codex too', () => {
    const { history } = runFor(600, 1);
    const subs = history.flat().filter((agent) => agent.kind === 'sub' && agent.source === 'codex');
    expect(subs.length).toBeGreaterThan(0);
  });

  test('Codex usage is priced with OpenAI models and has no cache writes', () => {
    const rows = createDemoSimulator({ seed: 1, now: () => T0 })
      .usageRows(T0)
      .filter((row) => row.account === 'demo-codex');
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.model))).toEqual(new Set(['gpt-5.6-sol', 'gpt-5.6-terra']));
    expect(rows.every((row) => row.cacheWrite === 0 && row.costUSD > 0)).toBe(true);
  });
});
