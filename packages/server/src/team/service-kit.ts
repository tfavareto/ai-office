// Helpers for the team service tests: synthetic offices, nodes (a service with its own state dir), waiting, and a raw
// authenticated connection for tests that speak the protocol by hand.
import { join } from 'node:path';
import { expect } from 'vitest';
import { normalizePairingCode, type Agent, type Project, type TeamSnapshot } from '@ai-office/shared';
import { silentLogger } from '../log';
import { freePort, makeTempDir, removeDir } from '../test-helpers';
import type { HostDeps } from './host';
import { TeamService } from './service';

export const SECRET = ['SECRET_PATH_91', 'SECRET_PROMPT_27', 'SECRET_CMD_55', 'SECRET_BRANCH_08'] as const;

export function office(prefix: string, names: string[]): { projects: Project[]; agents: Agent[] } {
  const projects: Project[] = [
    { id: `/${SECRET[0]}/${prefix}-a`, name: `${prefix}-alpha`, path: `/${SECRET[0]}/${prefix}-a`, seed: 1, order: 0 },
  ];
  const agents = names.map((name, i): Agent => ({
    id: `${prefix}-agent-${i}`,
    kind: 'main',
    sessionId: `${prefix}-sess-${i}`,
    accountId: 'acc',
    projectId: projects[0]?.id as string,
    name,
    role: 'Principal',
    title: SECRET[1],
    look: 'f',
    seed: i,
    status: 'working',
    statusSince: Date.now() - 5000,
    activity: { id: 'x', at: 1, kind: 'bash', icon: '💻', text: SECRET[2], detail: SECRET[2] },
    recent: [],
    tasks: [],
    shells: [],
    stats: { toolCalls: 1, tokensIn: 1, tokensOut: 1, linesAdded: 0, linesRemoved: 0, subagents: 0 },
    gitBranch: SECRET[3],
    startedAt: i,
    lastEventAt: 1,
  }));
  return { projects, agents };
}

export interface Node {
  service: TeamService;
  state: string;
  changes: { n: number };
  setOffice(names: string[]): void;
}

/** Moves the service clocks forward (rate limits and the like) without waiting. */
export const clock = { offset: 0 };
const dirs: string[] = [];
const running: Node[] = [];

export async function node(
  prefix: string,
  names: string[],
  options: {
    state?: string;
    disabled?: boolean;
    hostOptions?: Pick<HostDeps, 'pending' | 'firstFrameMs' | 'addressOf'>;
  } = {},
): Promise<Node> {
  const state = options.state ?? join(await makeTempDir(`ai-office-team-${prefix}-`), 'state');
  if (options.state === undefined) dirs.push(join(state, '..'));
  let current = office(prefix, names);
  const changes = { n: 0 };
  const service = new TeamService({
    stateDir: state,
    log: silentLogger,
    now: () => Date.now() + clock.offset,
    disabled: options.disabled === true,
    loopback: true,
    source: () => current,
    onChange: () => void changes.n++,
    stretch: async (code, salt) => Buffer.concat([Buffer.from(code), salt]).subarray(0, 32),
    delayScale: 0.02,
    ...(options.hostOptions !== undefined ? { hostOptions: options.hostOptions } : {}),
  });
  const result: Node = {
    service,
    state,
    changes,
    setOffice: (next) => {
      current = office(prefix, next);
      service.tick();
    },
  };
  running.push(result);
  await service.start();
  return result;
}

export async function until(check: () => boolean, label: string, timeoutMs = 6000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export async function host(prefix = 'host', names = ['Helena'], options: { state?: string } = {}) {
  const n = await node(prefix, names, options);
  const port = await freePort();
  const pairing = await n.service.startHosting({ address: '127.0.0.1', port, name: 'Helena', teamName: 'Time Azul' });
  n.service.tick();
  return { n, port, code: normalizePairingCode(pairing.code) };
}

export async function member(h: { port: number; code: string }, name = 'Bruno', names = ['Bia', 'Caio']) {
  const m = await node(`m${name}`, names);
  await m.service.join({ address: '127.0.0.1', port: h.port, code: h.code, name });
  m.service.tick();
  return m;
}

export const people = (n: Node): TeamSnapshot['people'] => n.service.snapshot()?.people ?? [];

/** Stops every node and removes their state; call it from `afterEach`. */
export async function cleanup(): Promise<void> {
  clock.offset = 0;
  for (const n of running.splice(0)) await n.service.stop();
  for (const dir of dirs.splice(0)) await removeDir(dir);
}

/** An authenticated connection made by hand with the credentials a member stored (the member service must be stopped). */
export async function rawSession(h: { port: number }, m: Node) {
  const { readFile } = await import('node:fs/promises');
  const file = JSON.parse(await readFile(join(m.state, 'team', 'member.json'), 'utf8')) as {
    memberId: string;
    identity: { pub: string; priv: string };
    hostPub: string;
  };
  const { connectTcp } = await import('./member');
  const { memberSession } = await import('./session');
  const { importIdentity, fromB64 } = await import('./keys');
  const { decode, encode } = await import('./wire');
  const conn = await connectTcp('127.0.0.1', h.port);
  const { channel, ready } = await memberSession(conn, {
    memberId: file.memberId,
    identity: importIdentity(file.identity),
    hostPub: fromB64(file.hostPub, 32),
  });
  expect(decode(channel.open(ready)).t).toBe('ready');
  return { conn, channel, ping: () => channel.seal(encode({ t: 'ping' })), decode, encode };
}
