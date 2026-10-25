import { stat } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { normalizePairingCode } from '@ai-office/shared';
import { freePort } from '../test-helpers';
import { TeamActionError } from './service';
import { SECRET, cleanup, clock, host, member, node, people, rawSession, until } from './service-kit';

afterEach(cleanup);

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

describe('hosting and joining over loopback', () => {
  test('a member pairs, shares its office and sees the host, with nothing but the allowed fields', async () => {
    const h = await host();
    const m = await member(h);

    await until(() => people(h.n).some((p) => p.online && p.agents.length === 2), 'host sees the member');
    await until(() => people(m).some((p) => p.host && p.agents.length === 1), 'member sees the host');

    const seenByHost = people(h.n).find((p) => !p.host);
    expect(seenByHost).toMatchObject({ name: 'Bruno', online: true, paused: false });
    expect(seenByHost?.agents.map((a) => a.name).sort()).toEqual(['Bia', 'Caio']);
    expect(seenByHost?.rooms).toEqual([{ key: expect.any(String), index: 1 }]);
    const everything = JSON.stringify([h.n.service.snapshot(), m.service.snapshot()]);
    for (const secret of SECRET) expect(everything).not.toContain(secret);
    expect(everything).not.toContain('mBruno-alpha');
    expect(m.service.snapshot()).toMatchObject({ role: 'member', link: 'connected', teamName: 'Time Azul' });
    expect(h.n.service.snapshot()).toMatchObject({ role: 'host', link: 'listening' });
  });

  test('the member does not see itself in the merged view', async () => {
    const h = await host();
    const m = await member(h);
    await until(() => people(m).some((p) => p.host), 'view arrives');

    expect(people(m).map((p) => p.name)).toEqual(['Helena']);
  });

  test('changes in the office reach the other side', async () => {
    const h = await host();
    const m = await member(h);
    await until(() => people(h.n).some((p) => p.agents.length === 2), 'first share');

    m.setOffice(['Bia', 'Caio', 'Duda']);

    await until(() => people(h.n).some((p) => p.agents.length === 3), 'updated share');
  });

  test('pausing sharing empties the share but keeps the member online; opt-in names appear only when enabled', async () => {
    const h = await host();
    const m = await member(h);
    await until(() => people(h.n).some((p) => p.agents.length === 2), 'first share');

    await m.service.setSharing({ projectNames: true });
    await until(() => people(h.n).some((p) => p.rooms[0]?.name === 'mBruno-alpha'), 'room name appears with opt-in');
    await m.service.setSharing({ paused: true });
    await until(() => people(h.n).some((p) => p.paused), 'paused share');

    const seen = people(h.n).find((p) => !p.host);
    expect(seen).toMatchObject({ online: true, paused: true, agents: [], rooms: [] });
  });

  test('state files are private and the host keeps no member secret', async () => {
    const h = await host();
    await member(h);

    const dir = join(h.n.state, 'team');
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'host.json'))).mode & 0o777).toBe(0o600);
    const { readFile } = await import('node:fs/promises');
    const file = JSON.parse(await readFile(join(dir, 'host.json'), 'utf8')) as { members: Record<string, unknown>[] };
    expect(Object.keys(file.members[0] ?? {}).sort()).toEqual(['createdAt', 'device', 'id', 'name', 'pub']);
  });
});

describe('pairing failures', () => {
  test('wrong codes are refused with one generic error, then rate-limited per address; the code stays open for others', async () => {
    const h = await host();
    const stranger = await node('stranger', ['X']);
    const join = (code: string) => stranger.service.join({ address: '127.0.0.1', port: h.port, code, name: 'Mallory' });

    await expect(join('ZZZZZZZZ')).rejects.toMatchObject({ code: 'pairing-failed' });
    await expect(join('YYYYYYYY')).rejects.toMatchObject({ code: 'pairing-failed' });
    await expect(join('XXXXXXXX')).rejects.toMatchObject({ code: 'rate-limited' });
    await expect(join(h.code)).rejects.toMatchObject({ code: 'rate-limited' });

    expect(h.n.service.status().host?.pairing).toMatchObject({
      locked: false,
      code: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/),
    });
    expect(h.n.service.status().host?.members).toEqual([]);
    expect(stranger.service.status().role).toBeNull();
  });

  test('after the wrong-proof window the right code still works: strangers cannot keep the pairing unusable', async () => {
    const h = await host();
    const stranger = await node('stranger', ['X']);
    const join = (code: string) => stranger.service.join({ address: '127.0.0.1', port: h.port, code, name: 'M' });
    await join('ZZZZZZZZ').catch(() => undefined);
    await join('YYYYYYYY').catch(() => undefined);

    clock.offset += 61_000;
    await join(h.code);

    expect(stranger.service.status().role).toBe('member');
  });

  test('regenerating the code kills the old one', async () => {
    const h = await host();
    const stranger = await node('stranger', ['X']);

    const fresh = await h.n.service.newCode();
    await expect(
      stranger.service.join({ address: '127.0.0.1', port: h.port, code: h.code, name: 'M' }),
    ).rejects.toBeInstanceOf(TeamActionError);
    clock.offset += 61_000;
    await stranger.service.join({
      address: '127.0.0.1',
      port: h.port,
      code: normalizePairingCode(fresh.code),
      name: 'M',
    });

    expect(stranger.service.status().role).toBe('member');
  });

  test('a code works once', async () => {
    const h = await host();
    await member(h, 'First');
    const second = await node('second', ['Y']);

    await expect(
      second.service.join({ address: '127.0.0.1', port: h.port, code: h.code, name: 'Second' }),
    ).rejects.toMatchObject({ code: 'not-pairing' });
  });

  test('malformed input is refused before any connection', async () => {
    const stranger = await node('stranger', ['X']);
    const join = (address: string, code = 'ABCDEFGH', name = 'Eve') =>
      stranger.service.join({ address, port: 4849, code, name });

    await expect(join('8.8.8.8')).rejects.toMatchObject({ code: 'invalid-address' });
    await expect(join('example.com')).rejects.toMatchObject({ code: 'invalid-address' });
    await expect(join('0.0.0.0')).rejects.toMatchObject({ code: 'invalid-address' });
    await expect(join('127.0.0.1', 'short')).rejects.toMatchObject({ code: 'invalid-code' });
    await expect(join('127.0.0.1', 'ABCDEFGH', '   ')).rejects.toMatchObject({ code: 'invalid-name' });
  });

  test('an unreachable host is reported', async () => {
    const stranger = await node('stranger', ['X']);
    const port = await freePort();

    await expect(
      stranger.service.join({ address: '127.0.0.1', port, code: 'ABCDEFGH', name: 'Eve' }),
    ).rejects.toMatchObject({ code: 'unreachable' });
  });
});

describe('host controls', () => {
  test('revoking a member disconnects it for good', async () => {
    const h = await host();
    const m = await member(h);
    await until(() => people(h.n).some((p) => p.online), 'online');
    const id = h.n.service.status().host?.members[0]?.id as string;

    await h.n.service.revoke(id);

    await until(() => m.service.snapshot()?.link === 'rejected', 'member rejected');
    expect(m.service.snapshot()?.error).toBe('revoked');
    expect(h.n.service.status().host?.members).toEqual([]);
  });

  test('ending the team tells members and deletes the host files', async () => {
    const h = await host();
    const m = await member(h);
    await until(() => people(m).some((p) => p.host), 'connected');

    await h.n.service.endTeam();

    await until(() => m.service.snapshot()?.link === 'rejected', 'member rejected');
    expect(m.service.snapshot()?.error).toBe('ended');
    expect(h.n.service.status().role).toBeNull();
    await expect(stat(join(h.n.state, 'team', 'host.json'))).rejects.toThrow();
  });

  test('a member that leaves is forgotten by the host and loses its keys', async () => {
    const h = await host();
    const m = await member(h);
    await until(() => people(h.n).some((p) => p.online), 'online');

    await m.service.leave();

    await until(() => h.n.service.status().host?.members.length === 0, 'host forgot the member');
    expect(m.service.status().role).toBeNull();
    await expect(stat(join(m.state, 'team', 'member.json'))).rejects.toThrow();
  });

  test('stopping the listener sets members offline; they reconnect when it is back, and after a restart of both', async () => {
    const h = await host();
    const m = await member(h);
    await until(() => m.service.snapshot()?.link === 'connected', 'connected');

    await h.n.service.stopHosting();
    await until(() => m.service.snapshot()?.link === 'offline', 'offline');
    await h.n.service.startHosting({ address: '127.0.0.1', port: h.port, name: 'Helena' });
    await until(() => m.service.snapshot()?.link === 'connected', 'reconnected');
    expect(h.n.service.status().host?.members).toHaveLength(1);

    await m.service.stop();
    await h.n.service.stop();
    const hostAgain = await node('host', ['Helena'], { state: h.n.state });
    const memberAgain = await node('mBruno', ['Bia'], { state: m.state });
    await until(() => memberAgain.service.snapshot()?.link === 'connected', 'connected after restart');
    expect(hostAgain.service.status().host?.link).toBe('listening');
  });

  test('the host listens only on the chosen address and refuses public or unknown ones', async () => {
    const n = await node('h', ['A']);

    await expect(n.service.startHosting({ address: '0.0.0.0', name: 'H' })).rejects.toMatchObject({
      code: 'invalid-address',
    });
    await expect(n.service.startHosting({ address: '8.8.8.8', name: 'H' })).rejects.toMatchObject({
      code: 'invalid-address',
    });
    await expect(n.service.startHosting({ address: '10.255.255.254', name: 'H' })).rejects.toMatchObject({
      code: 'address-not-available',
    });
    await expect(n.service.startHosting({ address: '127.0.0.1', port: 80, name: 'H' })).rejects.toMatchObject({
      code: 'invalid-port',
    });
    await expect(n.service.startHosting({ address: '127.0.0.1', name: ' ' })).rejects.toMatchObject({
      code: 'invalid-name',
    });
    expect(n.service.status().role).toBeNull();
  });

  test('a computer is a host or a member, never both', async () => {
    const h = await host();
    const other = await node('o', ['A']);

    await expect(
      h.n.service.join({ address: '127.0.0.1', port: h.port, code: h.code, name: 'Me' }),
    ).rejects.toMatchObject({ code: 'already-host' });
    await member(h, 'Bruno');
    await expect(other.service.revoke('x')).rejects.toMatchObject({ code: 'not-host' });
  });

  test('team mode off by environment cannot be turned on', async () => {
    const n = await node('off', ['A'], { disabled: true });

    expect(n.service.status().available).toBe(false);
    await expect(n.service.startHosting({ address: '127.0.0.1', name: 'H' })).rejects.toMatchObject({
      code: 'team-disabled',
    });
  });
});

describe('the team listener', () => {
  test('answers an HTTP request with silence: no page, no API, no error text', async () => {
    const h = await host();
    const received: Buffer[] = [];
    const socket = connect(h.port, '127.0.0.1');
    socket.on('data', (data: Buffer) => received.push(data));
    await new Promise((resolve) => socket.once('connect', resolve));

    socket.write('GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\nGET / HTTP/1.1\r\n\r\n');
    await new Promise((resolve) => socket.once('close', resolve));

    expect(Buffer.concat(received).length).toBe(0);
  });

  test('refuses a hello of another protocol version with a clear error', async () => {
    const h = await host();
    const socket = connect(h.port, '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    const body = Buffer.from(JSON.stringify({ t: 'hello', v: 42, member: 'x'.repeat(12), e: 'AA==', n: 'AA==' }));
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);

    socket.write(Buffer.concat([head, body]));
    const reply = await new Promise<Buffer>((resolve) => socket.once('data', resolve));

    expect(JSON.parse(reply.subarray(4).toString())).toMatchObject({ t: 'error', code: 'version-mismatch' });
    socket.destroy();
  });

  test('drops connections beyond the pending cap without answering', async () => {
    const h = await host();
    const sockets = Array.from({ length: 6 }, () => connect(h.port, '127.0.0.1'));
    await Promise.all(sockets.map((s) => new Promise((resolve) => s.once('connect', resolve))));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const closed = sockets.filter((s) => s.destroyed || s.readyState !== 'open').length;

    expect(closed).toBeGreaterThanOrEqual(3);
    sockets.forEach((s) => s.destroy());
  });
});

describe('attacks on an authenticated connection', () => {
  async function paired() {
    const h = await host();
    const m = await member(h);
    await until(() => people(h.n).some((p) => p.online), 'online');
    await m.service.stop();
    await until(() => !people(h.n).some((p) => p.online), 'offline');
    return { h, m };
  }

  test('a replayed frame ends the connection', async () => {
    const { h, m } = await paired();
    const s = await rawSession({ port: h.port }, m);
    const frame = s.ping();

    s.conn.send(frame);
    expect(s.decode(s.channel.open(await s.conn.read(2000))).t).toBe('pong');
    s.conn.send(frame);

    await expect(s.conn.read(2000)).rejects.toMatchObject({ code: 'closed' });
  });

  test('a tampered frame ends the connection and changes nothing', async () => {
    const { h, m } = await paired();
    const s = await rawSession({ port: h.port }, m);
    const frame = s.channel.seal(s.encode({ t: 'share', share: { rooms: [], agents: [], paused: true } }));
    frame[3] = (frame[3] ?? 0) ^ 1;

    s.conn.send(frame);

    await expect(s.conn.read(2000)).rejects.toMatchObject({ code: 'closed' });
    expect(people(h.n).find((p) => !p.host)?.paused).toBe(false);
  });

  test('a frame over the size limit ends the connection', async () => {
    const { h, m } = await paired();
    const s = await rawSession({ port: h.port }, m);

    s.conn.send(Buffer.alloc(70 * 1024));

    await expect(s.conn.read(2000)).rejects.toMatchObject({ code: 'closed' });
  });

  test('a flood of messages is cut off', async () => {
    const { h, m } = await paired();
    const s = await rawSession({ port: h.port }, m);

    for (let i = 0; i < 80; i++) s.conn.send(s.ping());

    const end = Date.now() + 3000;
    let closed = false;
    while (!closed && Date.now() < end)
      closed = await s.conn.read(500).then(
        () => false,
        (e: { code: string }) => e.code === 'closed',
      );
    expect(closed).toBe(true);
  });

  test('a share with forbidden shape is refused, not stored', async () => {
    const { h, m } = await paired();
    const s = await rawSession({ port: h.port }, m);

    s.conn.send(s.channel.seal(s.encode({ t: 'share', share: { rooms: 'x', agents: [] } })));

    await expect(s.conn.read(2000).then((frame) => s.decode(s.channel.open(frame)).reason)).resolves.toBe(
      'protocol-error',
    );
  });

  test('a second connection of the same member replaces the first', async () => {
    const { h, m } = await paired();
    const first = await rawSession({ port: h.port }, m);
    const second = await rawSession({ port: h.port }, m);

    expect(first.decode(first.channel.open(await first.conn.read(2000))).reason).toBe('replaced');
    second.conn.destroy();
  });
});
