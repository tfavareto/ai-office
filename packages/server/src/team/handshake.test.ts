import { afterEach, describe, expect, test } from 'vitest';
import { isValidPairingCode, normalizePairingCode, PAIRING_MAX_FAILURES, PAIRING_TTL_MS } from '@ai-office/shared';
import { type Identity, edSign, newIdentity, safeEqual } from './keys';
import { PairingGate } from './pairing';
import { hostPair, memberPair, type HostPairContext, type NewMember } from './pair';
import { hostSession, memberSession, type HostSessionContext } from './session';
import { type Pair, connectedPair, relay } from './testkit';
import { ProtocolError, decode } from './wire';

let clock = 1_000_000;
const now = (): number => clock;
const pairs: Pair[] = [];
const fastStretch = async (code: string, salt: Buffer): Promise<Buffer> =>
  Buffer.concat([Buffer.from(code), salt]).subarray(0, 32);

async function link(): Promise<Pair> {
  const pair = await connectedPair();
  pairs.push(pair);
  return pair;
}

afterEach(async () => {
  clock = 1_000_000;
  for (const pair of pairs.splice(0)) await pair.close();
});

interface HostWorld {
  gate: PairingGate;
  host: Identity;
  members: Map<string, NewMember>;
  wrong: number;
  real: boolean;
  ctx: HostPairContext;
}

async function hostWorld(
  options: { maxFailures?: number; real?: boolean } = {},
): Promise<{ world: HostWorld; code: string }> {
  const gate = new PairingGate(now, {
    perAddress: options.maxFailures ?? PAIRING_MAX_FAILURES,
    monotonic: now,
    ...(options.real ? {} : { stretch: fastStretch }),
  });
  const status = await gate.open();
  const host = newIdentity();
  const members = new Map<string, NewMember>();
  const world: HostWorld = {
    gate,
    host,
    members,
    wrong: 0,
    real: options.real === true,
    ctx: {
      gate,
      address: '10.0.0.7',
      identity: host,
      teamId: 'team-0001-abcd',
      teamName: 'Time Azul',
      hostName: 'Helena',
      addMember: async (member) => {
        const id = `member-${members.size + 1}-xxxxxxxx`;
        members.set(id, member);
        return id;
      },
      onWrongProof: () => {
        world.wrong++;
      },
    },
  };
  return { world, code: normalizePairingCode(status.code) };
}

/** Runs one pairing attempt: the host answers the first message, the member goes through the handshake. */
async function attempt(world: HostWorld, code: string, extra?: { pair?: Pair; identity?: Identity }) {
  const pair = extra?.pair ?? (await link());
  const identity = extra?.identity ?? newIdentity();
  const hostSide = pair.server
    .read(2000)
    .then((frame) => hostPair(pair.server, decode(frame), world.ctx))
    .catch(() => undefined);
  const result = await memberPair(pair.client, {
    code,
    name: 'Ana',
    device: 'laptop',
    identity,
    ...(world.real ? {} : { stretch: fastStretch }),
  }).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await hostSide;
  return { result, identity };
}

describe('pairing code', () => {
  test('generated codes are 8 characters from the unambiguous alphabet', async () => {
    const { code } = await hostWorld();
    expect(isValidPairingCode(code)).toBe(true);
  });
});

describe('pairing handshake', () => {
  test("succeeds with the right code and gives both sides each other's keys", async () => {
    const { world, code } = await hostWorld();

    const { result, identity } = await attempt(world, code);

    expect(result.ok ? 'ok' : result.error).toBe('ok');
    if (!result.ok) return;
    expect(result.value.teamName).toBe('Time Azul');
    expect(result.value.hostName).toBe('Helena');
    expect(safeEqual(result.value.hostPub, world.host.publicRaw)).toBe(true);
    const stored = world.members.get(result.value.memberId);
    expect(stored?.name).toBe('Ana');
    expect(safeEqual(stored?.pub ?? Buffer.alloc(0), identity.publicRaw)).toBe(true);
  });

  test('works with the real scrypt stretching', async () => {
    const { world, code } = await hostWorld({ real: true });
    const { result } = await attempt(world, code);
    expect(result.ok).toBe(true);
  });

  test('a wrong code fails with a generic error and stores nobody', async () => {
    const { world } = await hostWorld();

    const { result } = await attempt(world, 'ZZZZZZZZ');

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : (result.error as ProtocolError).code).toBe('pairing-failed');
    expect(world.members.size).toBe(0);
    expect(world.wrong).toBe(1);
  });

  test('the code is single use: the second device with the same code is refused', async () => {
    const { world, code } = await hostWorld();

    const first = await attempt(world, code);
    const second = await attempt(world, code);

    expect(first.result.ok).toBe(true);
    expect(second.result.ok).toBe(false);
    expect((second.result as { error: ProtocolError }).error.code).toBe('not-pairing');
    expect(world.members.size).toBe(1);
  });

  test('an expired code is refused', async () => {
    const { world, code } = await hostWorld();
    clock += PAIRING_TTL_MS + 1;

    const { result } = await attempt(world, code);

    expect((result as { error: ProtocolError }).error.code).toBe('not-pairing');
  });

  test('regenerating kills the previous code', async () => {
    const { world, code } = await hostWorld();
    await world.gate.open();

    const { result } = await attempt(world, code);

    expect(result.ok).toBe(false);
    expect(world.members.size).toBe(0);
  });

  test('five wrong proofs lock the code for that address only: the right code is refused there, and works elsewhere', async () => {
    const { world, code } = await hostWorld();
    for (let i = 0; i < PAIRING_MAX_FAILURES; i++) await attempt(world, 'ZZZZZZZZ');

    const status = world.gate.status();
    const { result } = await attempt(world, code);
    const elsewhere = { ...world, ctx: { ...world.ctx, address: '10.0.0.99' } };
    const other = await attempt(elsewhere, code);

    expect(status).toMatchObject({ locked: false });
    expect(status?.code).not.toBe('');
    expect((result as { error: ProtocolError }).error.code).toBe('pairing-locked');
    expect(other.result.ok).toBe(true);
  });

  test('a pairing that cannot be stored does not use the code up', async () => {
    const { world, code } = await hostWorld();
    const original = world.ctx.addMember;
    let fail = true;
    world.ctx.addMember = async (member) => (fail ? { error: 'team-full' } : original(member));

    const first = await attempt(world, code);
    fail = false;
    const second = await attempt(world, code);

    expect((first.result as { error: ProtocolError }).error.code).toBe('team-full');
    expect(second.result.ok).toBe(true);
  });

  test('two right proofs at once: exactly one pairs, even while the first is still being stored', async () => {
    const { world, code } = await hostWorld();
    let release: () => void = () => undefined;
    const original = world.ctx.addMember;
    world.ctx.addMember = async (member) => {
      await new Promise<void>((resolve) => (release = resolve));
      return original(member);
    };

    const first = attempt(world, code);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = await attempt(world, code);
    release();
    const firstResult = await first;

    expect(second.result.ok).toBe(false);
    expect(firstResult.result.ok).toBe(true);
    expect(world.members.size).toBe(1);
  });

  test('a host that does not know the code (man in the middle) cannot complete the handshake', async () => {
    const { code } = await hostWorld();
    const { world: attacker } = await hostWorld();

    const { result } = await attempt(attacker, code);

    expect(result.ok).toBe(false);
    expect(attacker.members.size).toBe(0);
  });

  test('a relay that rewrites the host key in transit breaks the proofs', async () => {
    const { world, code } = await hostWorld();
    const victim = await link();
    const toHost = await link();
    relay(victim.server, toHost.client);
    relay(toHost.client, victim.server, (frame, index) => {
      if (index !== 0) return frame;
      const message = decode(frame);
      const forged = Buffer.from(String(message.e), 'base64');
      forged[0] = (forged[0] ?? 0) ^ 1;
      return Buffer.from(JSON.stringify({ ...message, e: forged.toString('base64') }));
    });
    const hostSide = toHost.server
      .read(2000)
      .then((frame) => hostPair(toHost.server, decode(frame), world.ctx))
      .catch(() => undefined);

    const result = await memberPair(victim.client, {
      code,
      name: 'Ana',
      device: 'x',
      identity: newIdentity(),
      stretch: fastStretch,
    }).catch((error: unknown) => error);
    await hostSide;

    expect(result).toBeInstanceOf(ProtocolError);
    expect(world.members.size).toBe(0);
  });

  test('connecting without the code gets nothing to test guesses on', async () => {
    const { world } = await hostWorld();
    const pair = await link();
    const hostSide = pair.server
      .read(2000)
      .then((frame) => hostPair(pair.server, decode(frame), world.ctx))
      .catch(() => undefined);
    pair.client.send(Buffer.from(JSON.stringify({ t: 'pair-hello', v: 1, e: Buffer.alloc(32, 7).toString('base64') })));
    const challenge = decode(await pair.client.read(2000));

    expect(Object.keys(challenge).sort()).toEqual(['e', 'n', 'salt', 't', 'v']);
    pair.client.destroy();
    await hostSide;
  });

  test('a protocol version mismatch is reported clearly', async () => {
    const { world } = await hostWorld();
    const pair = await link();
    const hostSide = pair.server
      .read(2000)
      .then((frame) => hostPair(pair.server, decode(frame), world.ctx))
      .catch(() => undefined);
    pair.client.send(
      Buffer.from(JSON.stringify({ t: 'pair-hello', v: 99, e: Buffer.alloc(32, 7).toString('base64') })),
    );

    const reply = decode(await pair.client.read(2000));
    await hostSide;

    expect(reply).toMatchObject({ t: 'error', code: 'version-mismatch' });
  });
});

// ---- sessions -------------------------------------------------------------------------------------------------------------

function sessionWorld(): { host: Identity; member: Identity; ctx: HostSessionContext; revoked: Set<string> } {
  const host = newIdentity();
  const member = newIdentity();
  const revoked = new Set<string>();
  return {
    host,
    member,
    revoked,
    ctx: {
      identity: host,
      lookup: (id) =>
        revoked.has(id) ? 'revoked' : id === 'member-1-xxxxxxxx' ? { pub: member.publicRaw } : 'unknown',
    },
  };
}

async function session(
  world: ReturnType<typeof sessionWorld>,
  creds: { memberId?: string; identity?: Identity; hostPub?: Buffer } = {},
) {
  const pair = await link();
  const hostSide = pair.server
    .read(2000)
    .then((frame) => hostSession(pair.server, decode(frame), world.ctx))
    .catch((e: unknown) => e);
  const memberSide = memberSession(pair.client, {
    memberId: creds.memberId ?? 'member-1-xxxxxxxx',
    identity: creds.identity ?? world.member,
    hostPub: creds.hostPub ?? world.host.publicRaw,
  }).catch((e: unknown) => {
    pair.client.destroy();
    return e;
  });
  return { pair, hostSide, memberSide };
}

describe('session handshake', () => {
  test('both sides end with the same keys and talk both ways', async () => {
    const world = sessionWorld();
    const { pair, hostSide, memberSide } = await session(world);

    const host = await hostSide;
    pair.server.send((host as { channel: { seal(b: Buffer): Buffer } }).channel.seal(Buffer.from('ready')));
    const member = (await memberSide) as {
      channel: { open(b: Buffer): Buffer; seal(b: Buffer): Buffer };
      ready: Buffer;
    };

    expect(member.channel.open(member.ready).toString()).toBe('ready');
    pair.client.send(member.channel.seal(Buffer.from('hello host')));
    const received = (host as { channel: { open(b: Buffer): Buffer } }).channel.open(await pair.server.read(2000));
    expect(received.toString()).toBe('hello host');
  });

  test('a member that does not hold the stored key is dropped without keys', async () => {
    const world = sessionWorld();
    const { hostSide, memberSide } = await session(world, { identity: newIdentity() });

    expect(await hostSide).not.toHaveProperty('channel');
    expect(await memberSide).toBeInstanceOf(Error);
  });

  test('a host that is not the pinned one is detected by the member', async () => {
    const world = sessionWorld();
    const { memberSide } = await session(world, { hostPub: newIdentity().publicRaw });

    expect(((await memberSide) as ProtocolError).code).toBe('host-key-changed');
  });

  test('a removed member is told so, with a signed status', async () => {
    const world = sessionWorld();
    world.revoked.add('member-1-xxxxxxxx');
    const { memberSide } = await session(world);

    expect(((await memberSide) as ProtocolError).code).toBe('revoked');
  });

  test('an unknown member id is refused with a signed status', async () => {
    const world = sessionWorld();
    const { memberSide } = await session(world, { memberId: 'member-9-yyyyyyyy' });

    expect(((await memberSide) as ProtocolError).code).toBe('unknown-member');
  });

  test('a forged refusal (not signed by the pinned host) does not pass as revoked', async () => {
    const world = sessionWorld();
    const pair = await link();
    const forger = newIdentity();
    const hostSide = pair.server.read(2000).then(async (frame) => {
      const hello = decode(frame);
      return hostSession(pair.server, hello, { identity: forger, lookup: () => 'revoked' });
    });
    const result = await memberSession(pair.client, {
      memberId: 'member-1-xxxxxxxx',
      identity: world.member,
      hostPub: world.host.publicRaw,
    }).catch((e: unknown) => e);
    await hostSide;

    expect((result as ProtocolError).code).toBe('host-key-changed');
  });

  test('a replayed auth from an earlier session fails: the signature covers fresh nonces', async () => {
    const world = sessionWorld();
    const pair = await link();
    const hostSide = pair.server
      .read(2000)
      .then((frame) => hostSession(pair.server, decode(frame), world.ctx))
      .catch(() => undefined);
    pair.client.send(
      Buffer.from(
        JSON.stringify({
          t: 'hello',
          v: 1,
          member: 'member-1-xxxxxxxx',
          e: Buffer.alloc(32, 3).toString('base64'),
          n: Buffer.alloc(16, 1).toString('base64'),
        }),
      ),
    );
    await pair.client.read(2000);
    const stale = edSign(world.member, Buffer.from('an old transcript'));
    pair.client.send(Buffer.from(JSON.stringify({ t: 'auth', sig: stale.toString('base64') })));

    expect(await hostSide).toBe('bad-signature');
  });

  test('a hello of another protocol version is reported by the host', async () => {
    const world = sessionWorld();
    const pair = await link();
    const hostSide = pair.server
      .read(2000)
      .then((frame) => hostSession(pair.server, decode(frame), world.ctx))
      .catch((e: unknown) => e);
    pair.client.send(
      Buffer.from(JSON.stringify({ t: 'hello', v: 7, member: 'member-1-xxxxxxxx', e: 'AA==', n: 'AA==' })),
    );

    expect(((await hostSide) as ProtocolError).code).toBe('version-mismatch');
  });
});
