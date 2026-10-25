// Regression tests for the fixes of the security review: each describe names the finding it covers.
import { readFile, stat } from 'node:fs/promises';
import { type Server, connect, createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { TEAM_PROTOCOL_VERSION } from '@ai-office/shared';
import { silentLogger } from '../log';
import { makeTempDir, removeDir } from '../test-helpers';
import { isSharedAddress } from './addresses';
import { FrameError } from './conn';
import { TeamHost } from './host';
import { exportIdentity, newIdentity, toB64 } from './keys';
import { TeamMember, connectTcp } from './member';
import { hostSession } from './session';
import { memberSession } from './session';
import { cleanup, host, member, node, people, rawSession, until } from './service-kit';
import type { HostFile, JoinedFile } from './store';
import { decode, encode } from './wire';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
afterEach(cleanup);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function joinedFiles(m: {
  state: string;
}): Promise<{ memberId: string; identity: { pub: string; priv: string }; hostPub: string }> {
  return JSON.parse(await readFile(join(m.state, 'team', 'member.json'), 'utf8')) as never;
}

describe('M1: a removed member cannot finish a handshake that was already running', () => {
  test('revoking between hello and auth cuts the handshake and no session ever starts', async () => {
    const h = await host();
    const m = await member(h);
    await until(() => people(h.n).some((p) => p.online), 'online');
    await m.service.stop();
    await until(() => !people(h.n).some((p) => p.online), 'offline');
    const creds = await joinedFiles(m);
    const { importIdentity, fromB64 } = await import('./keys');
    const conn = await connectTcp('127.0.0.1', h.port);
    const send = conn.send.bind(conn);
    let held: Buffer | undefined;
    let sent = 0;
    conn.send = (body: Buffer): boolean => {
      if (++sent === 2) {
        held = body;
        return true;
      }
      return send(body);
    };
    const attempt = memberSession(conn, {
      memberId: creds.memberId,
      identity: importIdentity(creds.identity),
      hostPub: fromB64(creds.hostPub, 32),
    }).then(
      () => 'session',
      () => 'refused',
    );
    await until(() => held !== undefined, 'hello answered, auth held back');

    await h.n.service.revoke(creds.memberId);
    if (held !== undefined) send(held);

    expect(await attempt).toBe('refused');
    await wait(100);
    expect(people(h.n).some((p) => p.online)).toBe(false);
    expect(h.n.service.status().host?.members).toEqual([]);
  });

  test('after the removal every hello is answered "revoked" with a signed status', async () => {
    const h = await host();
    const m = await member(h);
    await until(() => people(h.n).some((p) => p.online), 'online');
    const creds = await joinedFiles(m);
    await h.n.service.revoke(creds.memberId);
    await until(() => m.service.snapshot()?.link === 'rejected', 'rejected');

    expect(m.service.snapshot()?.error).toBe('revoked');
  });
});

describe('M2: changes to the host file never overwrite each other', () => {
  const file = (): HostFile => ({
    teamId: 'team-abcdef12',
    teamName: 'T',
    hostName: 'H',
    hostDevice: 'd',
    identity: exportIdentity(newIdentity()),
    members: ['member-aaaaaaaa', 'member-bbbbbbbb'].map((id) => ({
      id,
      name: id,
      device: '',
      pub: exportIdentity(newIdentity()).pub,
      createdAt: 1,
    })),
    revoked: [],
  });

  test('a removal, a rename and a listener change running together all survive on disk, whatever order the disk answers in', async () => {
    let disk: HostFile | undefined;
    let delay = 40;
    const h = new TeamHost(file(), {
      now: Date.now,
      log: silentLogger,
      onChange: () => undefined,
      save: async (next) => {
        await wait(delay);
        delay = Math.max(1, delay - 15);
        disk = next;
        return true;
      },
    });

    await Promise.all([
      h.revoke('member-aaaaaaaa'),
      h.setNames({ hostName: 'Renamed' }),
      h.setListen({ address: '127.0.0.1', port: 4849 }),
      h.revoke('member-bbbbbbbb'),
    ]);
    await h.drain();

    expect(disk?.members).toEqual([]);
    expect(disk?.revoked).toEqual(['member-aaaaaaaa', 'member-bbbbbbbb']);
    expect(disk?.hostName).toBe('Renamed');
    expect(disk?.listen).toEqual({ address: '127.0.0.1', port: 4849 });
  });

  test('a removal and a new member paired at the same time both end up on disk', async () => {
    const h = await host();
    const first = await member(h, 'First');
    await until(() => people(h.n).some((p) => p.online), 'online');
    const firstId = (await joinedFiles(first)).memberId;
    const code = (await h.n.service.newCode()).code.replace('-', '');
    const second = await node('second', ['Z']);

    await Promise.all([
      h.n.service.revoke(firstId),
      second.service.join({ address: '127.0.0.1', port: h.port, code, name: 'Second' }),
      first.service.stop(),
    ]);

    const stored = JSON.parse(await readFile(join(h.n.state, 'team', 'host.json'), 'utf8')) as HostFile;
    expect(stored.members.map((m) => m.name)).toEqual(['Second']);
    expect(stored.revoked).toContain(firstId);
  });

  test('ending the team while a member disconnects leaves no host file behind', async () => {
    const h = await host();
    const m = await member(h);
    await until(() => people(h.n).some((p) => p.online), 'online');

    await Promise.all([h.n.service.endTeam(), m.service.stop()]);
    await wait(200);

    await expect(stat(join(h.n.state, 'team', 'host.json'))).rejects.toThrow();
  });
});

describe('M3: idle strangers do not block pairing and reconnects', () => {
  test('idle connections are cut after the first-frame deadline and cannot exceed their share', async () => {
    const h = await host('host', ['H'], {});
    // A host with tight limits: two connections per address, a quarter-second first-frame deadline.
    const tight = await node('tight', ['T'], {
      hostOptions: { pending: { max: 4, perAddress: 2, perSubnet: 4, reserve: 0 }, firstFrameMs: 300 },
    });
    const { freePort } = await import('../test-helpers');
    const port = await freePort();
    const pairing = await tight.service.startHosting({ address: '127.0.0.1', port, name: 'Tight' });
    const m = await node('visitor', ['V']);
    const idle = [connect(port, '127.0.0.1'), connect(port, '127.0.0.1'), connect(port, '127.0.0.1')];
    await Promise.all(idle.map((s) => new Promise((resolve) => s.once('connect', resolve))));
    await wait(100);

    const refused = idle.filter((s) => s.destroyed || s.readyState !== 'open').length;
    await wait(500);
    const cut = idle.filter((s) => s.destroyed || s.readyState !== 'open').length;
    await m.service.join({ address: '127.0.0.1', port, code: pairing.code.replace('-', ''), name: 'V' });

    expect(refused).toBeGreaterThanOrEqual(1);
    expect(cut).toBe(3);
    expect(m.service.status().role).toBe('member');
    idle.forEach((s) => s.destroy());
    void h;
  });
});

describe('M5: a forged answer cannot switch a member off for good', () => {
  test('a stranger answering with another key leaves a warning and the member keeps checking, slowly', async () => {
    let connections = 0;
    const stranger = newIdentity();
    const server: Server = createServer((socket) => {
      connections++;
      void import('./conn').then(async ({ FramedConn }) => {
        const conn = new FramedConn(socket, 4096);
        const hello = decode(await conn.read(2000));
        await hostSession(conn, hello, { identity: stranger, lookup: () => 'revoked' }).catch(() => undefined);
        conn.destroy();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const dir = await makeTempDir('ai-office-forged-');
    const real = newIdentity();
    const file: JoinedFile = {
      teamId: 'team-abcdef12',
      teamName: 'T',
      memberId: 'member-12345678',
      name: 'Ana',
      device: '',
      identity: exportIdentity(newIdentity()),
      hostPub: toB64(real.publicRaw),
      hostName: 'H',
      address: '127.0.0.1',
      port,
    };
    const member = new TeamMember(file, {
      now: Date.now,
      log: silentLogger,
      onChange: () => undefined,
      delayScale: 0.01,
    });

    member.start();
    await until(() => connections >= 2, 'it checks again');

    expect(member.link).toBe('offline');
    expect(member.error).toBe('host-key-changed');
    await member.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await removeDir(dir);
  });
});

describe('L1: repeated failed proofs from one address are refused', () => {
  test('after eight bad signatures the next hello is answered "rate-limited"', async () => {
    const h = await host();
    const m = await member(h);
    await until(() => people(h.n).some((p) => p.online), 'online');
    const creds = await joinedFiles(m);
    await m.service.stop();
    const bad = async (): Promise<string> => {
      const conn = await connectTcp('127.0.0.1', h.port);
      conn.send(
        encode({
          t: 'hello',
          v: TEAM_PROTOCOL_VERSION,
          member: creds.memberId,
          e: toB64(Buffer.alloc(32, 9)),
          n: toB64(Buffer.alloc(16, 1)),
        }),
      );
      const answer = decode(await conn.read(2000));
      if (answer.t === 'error') {
        conn.destroy();
        return String(answer.code);
      }
      conn.send(encode({ t: 'auth', sig: toB64(Buffer.alloc(64, 3)) }));
      await conn.read(2000).catch((error: unknown) => {
        expect(error).toBeInstanceOf(FrameError);
      });
      conn.destroy();
      return 'failed';
    };

    const results: string[] = [];
    for (let i = 0; i < 9; i++) results.push(await bad());

    expect(results.slice(0, 8)).toEqual(Array(8).fill('failed'));
    expect(results[8]).toBe('rate-limited');
  });
});

describe('L6: a host with no pairing code open does not answer a stranger', () => {
  test('a pair-hello is closed without a byte, before and after the code is used', async () => {
    const h = await host();
    const probe = async (): Promise<number> => {
      const received: Buffer[] = [];
      const socket = connect(h.port, '127.0.0.1');
      socket.on('data', (data: Buffer) => received.push(data));
      await new Promise((resolve) => socket.once('connect', resolve));
      const body = encode({ t: 'pair-hello', v: TEAM_PROTOCOL_VERSION, e: toB64(Buffer.alloc(32, 5)) });
      const head = Buffer.alloc(4);
      head.writeUInt32BE(body.length);
      socket.write(Buffer.concat([head, body]));
      await new Promise((resolve) => socket.once('close', resolve));
      return Buffer.concat(received).length;
    };
    expect(await probe()).toBeGreaterThan(0);

    await member(h);

    expect(await probe()).toBe(0);
  });
});

describe('L7: a shared address (100.64.0.0/10) needs a confirmation', () => {
  test('is recognized, and hosting there is refused until the person confirms', async () => {
    expect(isSharedAddress('100.64.0.1')).toBe(true);
    expect(isSharedAddress('100.127.255.254')).toBe(true);
    expect(isSharedAddress('100.128.0.1')).toBe(false);
    expect(isSharedAddress('192.168.0.1')).toBe(false);
    const n = await node('shared', ['S']);

    await expect(n.service.startHosting({ address: '100.100.1.2', name: 'S' })).rejects.toMatchObject({
      code: 'shared-address',
    });
    await expect(
      n.service.startHosting({ address: '100.100.1.2', name: 'S', allowShared: true }),
    ).rejects.toMatchObject({ code: 'address-not-available' });
  });
});

describe('L5 and L8: the device name and the key fingerprints', () => {
  test('without a name the device is a neutral label, never the host name; a typed name is kept', async () => {
    const h = await host();
    await member(h, 'Neutral');
    const code = (await h.n.service.newCode()).code.replace('-', '');
    const named = await node('named', ['N']);
    await named.service.join({ address: '127.0.0.1', port: h.port, code, name: 'Named', device: 'Mesa do canto' });

    const devices = h.n.service.status().host?.members.map((m) => m.device);

    expect(devices?.[0]).toMatch(/^PC-[0-9a-f]{4}$/);
    expect(devices?.[1]).toBe('Mesa do canto');
    expect(h.n.service.status().host?.members.length).toBe(2);
  });

  test('the member shows the very fingerprint the host shows', async () => {
    const h = await host();
    const m = await member(h);

    const hostSide = h.n.service.status().host?.fingerprint;
    const memberSide = m.service.status().member?.hostFingerprint;

    expect(hostSide).toMatch(/^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/);
    expect(memberSide).toBe(hostSide);
  });
});

describe('L9: housekeeping', () => {
  test('repeating the same share does not make everybody redraw', async () => {
    const h = await host();
    const m = await member(h);
    await until(() => people(h.n).some((p) => p.online && p.agents.length > 0), 'first share');
    await m.service.stop();
    await until(() => !people(h.n).some((p) => p.online), 'offline');
    const s = await rawSession(h, m);
    const share = { rooms: [], agents: [], paused: true };
    s.conn.send(s.channel.seal(s.encode({ t: 'share', share })));
    await until(() => people(h.n).some((p) => p.paused), 'first share seen');
    const before = h.n.changes.n;

    for (let i = 0; i < 5; i++) s.conn.send(s.channel.seal(s.encode({ t: 'share', share })));
    await wait(300);

    expect(h.n.changes.n).toBe(before);
    s.conn.destroy();
  });

  test('a failed write leaves no temporary file, and deleting a file cleans leftovers', async () => {
    const { writeJsonAtomic } = await import('../util/fs-safe');
    const { mkdir, readdir, writeFile } = await import('node:fs/promises');
    const dir = await makeTempDir('ai-office-tmp-');
    await mkdir(join(dir, 'target'));

    await expect(writeJsonAtomic(join(dir, 'target'), { a: 1 })).rejects.toThrow();

    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    const { TeamStore } = await import('./store');
    const store = new TeamStore(dir, silentLogger);
    await mkdir(join(dir, 'team'), { recursive: true });
    await writeFile(join(dir, 'team', 'host.json.abcd.tmp'), '{}');
    await writeFile(join(dir, 'team', 'host.json'), '{}');
    await store.deleteHost();
    expect(await readdir(join(dir, 'team'))).toEqual([]);
    await removeDir(dir);
  });

  test('management actions queue instead of interleaving', async () => {
    const h = await host();

    await Promise.all([h.n.service.newCode(), h.n.service.newCode(), h.n.service.stopHosting()]);

    expect(h.n.service.status().host?.link).toBe('stopped');
  });
});
